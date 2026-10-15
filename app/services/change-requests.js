import Service, { service } from '@ember/service';
import { getOwner } from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { recordIdentifierFor } from '@warp-drive/core';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import { isLoaded } from 'frontend-organization-portal/utils/records';
import uuid from 'frontend-organization-portal/utils/uuid';

const ENDPOINT = '/change-requests';
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

/**
 * A change request the service refused (403, 422), could not apply (409),
 * that never reached it, or that was applied but could not be followed up in
 * the browser. `message` is meant for the user; `errors` is the JSON:API
 * errors array of the response, when there was one.
 *
 * The flags tell the page what to do with its dirty state:
 * - `applied`: the service answered 2xx, so the change is in the application
 *   graph; the page must not offer a retry (it would apply the change twice)
 *   but leave and reload.
 * - `outcomeUnknown`: a 5xx; the service may have applied the request before
 *   the dispatcher or the service itself gave up (e.g. a gateway timeout
 *   after the one-transaction apply). A retry could duplicate the change, so
 *   the page blocks it until it is reloaded.
 * - neither: the service refused (4xx) or the request never left; the page
 *   keeps its edits for a correction and a retry.
 */
export class ChangeRequestError extends Error {
  constructor(
    message,
    { status = null, errors = [], applied = false, cause } = {},
  ) {
    super(message, { cause });
    this.name = 'ChangeRequestError';
    this.status = status;
    this.errors = errors;
    this.applied = applied;
  }

  get outcomeUnknown() {
    return !this.applied && this.status !== null && this.status >= 500;
  }

  static async fromResponse(response) {
    let errors = [];
    try {
      const body = await response.json();
      errors = Array.isArray(body?.errors) ? body.errors : [];
    } catch {
      // Not a JSON:API error document, the status is all we know.
    }

    let message =
      errors
        .map((error) => error.detail || error.title)
        .filter(Boolean)
        .join(' ') || `De wijziging werd geweigerd (HTTP ${response.status}).`;

    if (response.status >= 500) {
      message = `De wijziging kon niet verwerkt worden (HTTP ${response.status}). Herlaad de pagina en controleer of de wijziging is doorgevoerd voor u opnieuw opslaat.`;
    }

    return new ChangeRequestError(message, { status: response.status, errors });
  }
}

/**
 * Edits go to the change-request service, never to the resource routes: the
 * service checks who may edit what, keeps the request with its versions and
 * applies it to the application graph (one request holds the full proposed
 * state of one aggregate, such as the kerngegevens of an organisation or one
 * site with its address and contact points).
 */
export default class ChangeRequestsService extends Service {
  @service store;

  /**
   * The permissions per organisation uuid, as `loadPermissions` fetched them:
   * `{ canEdit, rules }`. Replaced, never mutated, so that `canEdit`
   * recomputes.
   */
  @tracked permissionsByTarget = new Map();

  /**
   * The uuid of the organisation whose pages are open, set by the
   * organisation route when it is entered or its organisation changes and
   * cleared when it is left. Null outside the organisation pages.
   */
  @tracked currentTargetId = null;

  /**
   * The permissions request in flight per organisation uuid, so that only
   * the answer to the latest request for an organisation is kept.
   */
  pendingPermissions = new Map();

  /**
   * Whether the session may edit the organisation whose pages are open. The
   * organisation route sets which organisation that is once a transition into
   * it is committed, so an answer for another organisation, however late it
   * arrives, never reads as true here. During a transition into an
   * organisation use `canEditOrganization` with the id of the transition.
   */
  get canEdit() {
    return this.canEditOrganization(this.currentTargetId);
  }

  /**
   * Whether the session may edit an organisation, from the answer
   * `loadPermissions` fetched for it. False for an organisation whose
   * permissions were not loaded.
   *
   * @param {string} targetId - uuid of the organisation
   * @returns {boolean}
   */
  canEditOrganization(targetId) {
    if (!targetId) {
      return false;
    }

    return this.permissionsByTarget.get(targetId)?.canEdit === true;
  }

  /**
   * Ask the service whether the session may edit an organisation. The service
   * checks again on every submit; this answer only decides what the pages
   * show, so when the check itself fails (the service does not answer, or
   * something else than the service answers) the organisation is read-only.
   *
   * @param {string} targetId - uuid of the organisation
   * @returns {Promise<{ canEdit: boolean, rules: string[] }>} `rules` names
   *     the policy rules that granted the permission
   */
  async permissions(targetId) {
    const readOnly = { canEdit: false, rules: [] };
    const query = new URLSearchParams({ target: targetId });

    let body;
    try {
      const response = await fetch(`${ENDPOINT}/permissions?${query}`, {
        headers: { Accept: JSON_API_CONTENT_TYPE },
      });

      if (!response.ok) {
        console.warn(
          `Could not determine the permissions for organisation ${targetId} (HTTP ${response.status}), treating it as read-only.`,
        );
        return readOnly;
      }

      body = await response.json();
    } catch (error) {
      console.warn(
        `Could not determine the permissions for organisation ${targetId}, treating it as read-only.`,
        error,
      );
      return readOnly;
    }

    return {
      canEdit: body?.['can-edit'] === true,
      rules: Array.isArray(body?.rules) ? body.rules : [],
    };
  }

  /**
   * Fetch the permissions for an organisation and keep them for
   * `canEditOrganization` and `canEdit`. When several requests for the same
   * organisation are in flight only the answer to the latest one is kept;
   * answers for other organisations land under their own id and never
   * replace this one.
   *
   * @param {string} targetId - uuid of the organisation
   * @returns {Promise<{ canEdit: boolean, rules: string[] }>}
   */
  async loadPermissions(targetId) {
    const request = this.permissions(targetId);
    this.pendingPermissions.set(targetId, request);

    const permissions = await request;

    if (this.pendingPermissions.get(targetId) === request) {
      this.pendingPermissions.delete(targetId);
      this.permissionsByTarget = new Map(this.permissionsByTarget).set(
        targetId,
        permissions,
      );
    }

    return permissions;
  }

  /**
   * Make an organisation the one whose pages are open, see `canEdit`. Called
   * by the organisation route once a transition into it is committed.
   *
   * @param {string} targetId - uuid of the organisation
   */
  enterOrganization(targetId) {
    this.currentTargetId = targetId;
  }

  /**
   * No organisation pages are open any more: outside them nothing is editable.
   */
  leaveOrganization() {
    this.currentTargetId = null;
  }

  /**
   * Discard the unsaved relationship changes of a record, e.g. the site a
   * cancelled page added to an organisation. `rollbackAttributes` only covers
   * the attributes. Does nothing for a record that is unloaded already.
   *
   * @param {Model} record
   */
  rollbackRelationships(record) {
    if (isLoaded(record)) {
      this.store.cache.rollbackRelationships(recordIdentifierFor(record));
    }
  }

  /**
   * Submit the proposed state of one aggregate as a change request.
   *
   * Every record is serialised with the JSON:API serializer of the store, so
   * the service receives the types, attributes and relationships that
   * mu-cl-resources would. New records get a `lid` (a UUID) and are
   * referenced by it from the relationships of the other records. The
   * records are sent in the given order, so pass dependencies first (address
   * and contact points before the site, the site before the organisation).
   *
   * On success (201) the local changes are discarded and every record is
   * reloaded from the backend: the persisted ones with the relationships the
   * request changed, the new ones under the uuids the service minted (the
   * client-side new records are unloaded). On a refusal (4xx) nothing is
   * touched, so the page keeps its dirty state, and a `ChangeRequestError`
   * carries the message of the service. An error after the service applied
   * the request (the answer lacks the id of a new record, a reload fails) is
   * a `ChangeRequestError` with `applied` set: the change is in the
   * application graph, the page must leave and reload instead of retrying.
   *
   * @param {string} aggregate - name of the aggregate, e.g. `organization-core-data`
   * @param {string} target - uuid of the organisation the request is about
   * @param {Model[]} records - the records of the aggregate, dependencies first
   * @returns {Promise<Map<Model, Model|null>>} for every submitted record the
   *     reloaded record (a fresh record for the new ones, null for the deleted
   *     ones)
   */
  async submit(aggregate, target, records) {
    const serializer = getOwner(this).lookup('serializer:application');
    const lids = new Map(
      records
        .filter((record) => record.isNew)
        .map((record) => [record, uuid()]),
    );
    const operations = records.map((record) =>
      serializeOperation(serializer, record, lids),
    );

    const response = await post(ENDPOINT, {
      data: {
        type: 'change-requests',
        attributes: { aggregate, operations },
        relationships: {
          target: { data: { type: 'organizations', id: target } },
        },
      },
    });

    if (!response.ok) {
      throw await ChangeRequestError.fromResponse(response);
    }

    const body = await response.json();
    const mintedIds = body?.data?.attributes?.lids ?? {};

    // Check before touching the store: without its uuid a new record cannot
    // be reloaded and the page would lose it.
    for (const [record, lid] of lids) {
      if (!mintedIds[lid]) {
        throw new ChangeRequestError(
          `De wijziging is doorgevoerd, maar het antwoord bevat geen id voor de nieuwe ${record.constructor.modelName} (lid ${lid}). Herlaad de pagina om de nieuwe gegevens te zien.`,
          { status: response.status, applied: true },
        );
      }
    }

    // Decide what to reload while the local state still tells what changed
    const reloads = records.map((record, index) => ({
      record,
      type: record.constructor.modelName,
      id: record.isNew ? mintedIds[lids.get(record)] : record.id,
      isDeleted: record.isDeleted,
      include: record.isNew
        ? Object.keys(operations[index].data.relationships ?? {})
        : Array.from(
            this.store.cache
              .changedRelationships(recordIdentifierFor(record))
              .keys(),
            (name) => serializer.keyForRelationship(name, null, 'serialize'),
          ),
    }));

    // The service applied the request: the backend is now the truth
    for (const record of records) {
      if (record.isNew) {
        // Rolling back a new record unloads it
        record.rollbackAttributes();
      } else if (record.isDeleted) {
        record.unloadRecord();
      } else {
        this.store.cache.rollbackRelationships(recordIdentifierFor(record));
        record.rollbackAttributes();
      }
    }

    const saved = new Map();
    try {
      await Promise.all(
        reloads.map(async ({ record, type, id, isDeleted, include }) => {
          if (isDeleted) {
            saved.set(record, null);
            return;
          }

          const options = { reload: true };
          if (include.length > 0) {
            options.include = include.join(',');
          }
          const { content } = await this.store.request(
            findRecord(type, id, options),
          );
          saved.set(record, content);
        }),
      );
    } catch (error) {
      // The change is applied; only the store is half reloaded. The page
      // leaves and reloads instead of retrying, which would apply it twice.
      throw new ChangeRequestError(
        'De wijziging is doorgevoerd, maar de pagina kon niet vernieuwd worden. Herlaad de pagina om de nieuwe gegevens te zien.',
        { status: response.status, applied: true, cause: error },
      );
    }

    return saved;
  }
}

/**
 * One operation of the request: the record as the JSON:API serializer writes
 * it, with the references to new records that the serializer leaves out
 * added back as `lid` references.
 */
function serializeOperation(serializer, record, lids) {
  const snapshot = record._createSnapshot();
  const { data } = serializer.serialize(snapshot, { includeId: true });

  if (record.isNew) {
    data.lid = lids.get(record);
  }

  record.eachRelationship((name, descriptor) => {
    const key = serializer.keyForRelationship(
      name,
      descriptor.kind,
      'serialize',
    );

    if (descriptor.kind === 'belongsTo') {
      const related = snapshot.belongsTo(name);
      if (related?.isNew) {
        data.relationships ??= {};
        data.relationships[key] = {
          data: resourceIdentifier(serializer, related, lids),
        };
      }
    } else if (serializer.shouldSerializeHasMany(snapshot, name, descriptor)) {
      // The serializer writes the persisted members only. The new members
      // that are part of the request are added back by lid; a new member
      // that is not (such as the placeholder identifiers the kerngegevens
      // page adds to `organization.identifiers`) cannot exist on the server
      // yet and is left out, as the serializer leaves it out.
      const related = snapshot
        .hasMany(name)
        ?.filter((item) => !item.isNew || lids.has(item.record));
      if (related?.some((item) => item.isNew)) {
        data.relationships ??= {};
        data.relationships[key] = {
          data: related.map((item) =>
            resourceIdentifier(serializer, item, lids),
          ),
        };
      }
    }
  });

  let op = 'update';
  if (record.isNew) {
    op = 'create';
  } else if (record.isDeleted) {
    op = 'delete';
  }

  return { op, data };
}

function resourceIdentifier(serializer, snapshot, lids) {
  const type = serializer.payloadKeyFromModelName(snapshot.modelName);

  if (!snapshot.isNew) {
    return { type, id: snapshot.id };
  }

  const lid = lids.get(snapshot.record);
  if (!lid) {
    throw new Error(
      `A ${snapshot.modelName} that is not part of the change request is referenced by a record in it. Add it to the records of the request.`,
    );
  }

  return { type, lid };
}

async function post(url, document) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': JSON_API_CONTENT_TYPE,
        Accept: JSON_API_CONTENT_TYPE,
      },
      body: JSON.stringify(document),
    });
  } catch (error) {
    throw new ChangeRequestError(
      'De wijziging kon niet verstuurd worden. Controleer de verbinding en probeer opnieuw.',
      { cause: error },
    );
  }
}
