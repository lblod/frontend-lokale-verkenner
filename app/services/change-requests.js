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
 * The status of a request the service recorded without applying it; it waits
 * for a decision by ABB.
 */
const SUBMITTED = 'ingediend';
/**
 * The status of a request whose apply failed; a hertoepassing applies its
 * stored versions again.
 */
const FAILED = 'mislukt';
/**
 * The statuses of an approved and of a withdrawn request.
 */
const APPROVED = 'goedgekeurd';
const WITHDRAWN = 'ingetrokken';

const APPLY_FAILED_MESSAGE =
  'De wijziging kon niet doorgevoerd worden: het toepassen ervan mislukte. Je aanvraag is bewaard. Pas ze opnieuw toe, of herlaad de pagina en controleer de gegevens voor je opnieuw opslaat.';

/**
 * A change request the service refused (403, 422), could not apply (409),
 * held for a decision instead of applying it, that never reached it, or that
 * was applied but could not be followed up in the browser. `message` is meant
 * for the user; `errors` is the JSON:API errors array of the response, when
 * there was one; `requestId` is the uuid of the request the service kept, for
 * a held request and for one whose apply failed.
 *
 * The flags tell the page what to do with its dirty state:
 * - `applied`: the service answered 2xx, so the change is in the application
 *   graph; the page must not offer a retry (it would apply the change twice)
 *   but leave and reload.
 * - `held`: the service recorded the request but did not apply it (status
 *   `ingediend`): someone else changed the same data since the page loaded
 *   it, and the request waits for a decision by ABB. `conflicts` lists the
 *   fields as the service reports them (`{ resource: { type, id }, key,
 *   base, current, proposed, 'competing-requests' }`). `submit` has
 *   discarded the local changes and reloaded the records; the page rebuilds
 *   its form from them, so that it shows the current values, and tells the
 *   user which fields were changed meanwhile. Saving again is a new request,
 *   next to the held one, which `withdraw` can withdraw. `reloadFailed` is
 *   set when the records could not be reloaded (`cause` is the error): the
 *   store then holds the values the page loaded, not the current ones, so a
 *   new save would start from stale values and the page blocks it until it
 *   is reloaded.
 * - `applyFailed`: a 409 for a request whose apply failed twice: the service
 *   kept it with status `mislukt`, and the apply may have stopped half-way,
 *   leaving the keys it changes empty on the master. A new request would
 *   start from the values the page loaded and conflict with that state, so
 *   the page blocks saving and offers to apply the kept request again
 *   (`reapply`).
 * - `outcomeUnknown`: a 5xx; the service may have applied the request before
 *   the dispatcher or the service itself gave up (e.g. a gateway timeout
 *   after the one-transaction apply). A retry could duplicate the change, so
 *   the page blocks it until it is reloaded.
 * - none: the service refused (4xx) or the request never left; the page
 *   keeps its edits for a correction and a retry.
 */
export class ChangeRequestError extends Error {
  constructor(
    message,
    {
      status = null,
      errors = [],
      applied = false,
      held = false,
      conflicts = [],
      reloadFailed = false,
      applyFailed = false,
      requestId = null,
      cause,
    } = {},
  ) {
    super(message, { cause });
    this.name = 'ChangeRequestError';
    this.status = status;
    this.errors = errors;
    this.applied = applied;
    this.held = held;
    this.conflicts = conflicts;
    this.reloadFailed = reloadFailed;
    this.applyFailed = applyFailed;
    this.requestId = requestId;
  }

  get outcomeUnknown() {
    return !this.applied && this.status !== null && this.status >= 500;
  }

  /**
   * Whether the service answered and refused (a 4xx), other than for an
   * apply that failed: trying the same again is refused again.
   */
  get refused() {
    return (
      this.status !== null &&
      this.status >= 400 &&
      this.status < 500 &&
      !this.applyFailed
    );
  }

  /**
   * The error for a response that is not ok.
   *
   * @param {Response} response
   * @param {Function} [messageFor] - `(status, errors) => message`, the
   *     message for the user in the context of the call; when it gives none,
   *     the message of the service, or one per status
   * @returns {Promise<ChangeRequestError>}
   */
  static async fromResponse(response, messageFor = () => undefined) {
    let errors = [];
    try {
      const body = await response.json();
      errors = Array.isArray(body?.errors) ? body.errors : [];
    } catch {
      // Not a JSON:API error document, the status is all we know.
    }

    const { status } = response;
    const request = changeRequestOf(errors);
    const applyFailed = status === 409 && request?.status === FAILED;

    let message = messageFor(status, errors);
    if (message === undefined && applyFailed) {
      message = APPLY_FAILED_MESSAGE;
    } else if (message === undefined && status >= 500) {
      message = `De wijziging kon niet verwerkt worden (HTTP ${status}). Herlaad de pagina en controleer of de wijziging is doorgevoerd voor u opnieuw opslaat.`;
    } else if (message === undefined) {
      message =
        errors
          .map((error) => error.detail || error.title)
          .filter(Boolean)
          .join(' ') || `De wijziging werd geweigerd (HTTP ${status}).`;
    }

    return new ChangeRequestError(message, {
      status,
      errors,
      applyFailed,
      requestId: applyFailed ? request.id : null,
    });
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
  @service toaster;

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
   * An update carries, as its base, the values the record was loaded with
   * (`meta.base`, see `serializeBase`), so that the service writes only the
   * keys the page changed and holds the request when someone else changed
   * one of them in the meantime.
   *
   * When the service applied the request (201, status `goedgekeurd`) the
   * local changes are discarded and every record is reloaded from the
   * backend: the persisted ones with the relationships the request changed,
   * the new ones under the uuids the service minted (the client-side new
   * records are unloaded). When it held the request (201, status
   * `ingediend`) the local changes are discarded too, the new records
   * unloaded and the persisted ones reloaded, and a `ChangeRequestError`
   * with `held` set carries the conflicts and the id of the request. On a
   * refusal (4xx) nothing is touched, so the page keeps its dirty state, and
   * a `ChangeRequestError` carries the message of the service; a 409 for an
   * apply that failed has `applyFailed` set and the id of the kept request,
   * see `reapply`. An error after the service applied
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
      serializeOperation(serializer, this.store.cache, record, lids),
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
    const attributes = body?.data?.attributes ?? {};

    if (attributes.status === SUBMITTED) {
      const conflicts = Array.isArray(attributes.conflicts)
        ? attributes.conflicts
        : [];
      let cause;
      try {
        await this.reloadUnapplied(serializer, records);
      } catch (error) {
        // Still nothing is applied, but the store now holds the values the
        // page loaded instead of the current ones, and a new save would
        // start from them: the page asks for a reload.
        console.error(
          'The records of a held change request could not be reloaded:',
          error,
        );
        cause = error;
      }
      throw new ChangeRequestError(heldMessage(conflicts), {
        status: response.status,
        held: true,
        conflicts,
        requestId: body?.data?.id ?? null,
        reloadFailed: cause !== undefined,
        cause,
      });
    }

    const mintedIds = attributes.lids ?? {};

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
        : changedRelationshipKeys(serializer, this.store.cache, record),
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
          saved.set(
            record,
            isDeleted ? null : await this.refetch(type, id, include),
          );
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

    // The service withdraws the earlier requests of this organisation that
    // still waited for ABB and that this one replaces (it rewrote all of
    // their fields); tell the user they are gone.
    const superseded = Array.isArray(attributes.superseded)
      ? attributes.superseded
      : [];
    if (superseded.length) {
      this.toaster.success(
        superseded.length === 1
          ? 'Deze wijziging vervangt je eerdere aanvraag die nog op een beslissing van ABB wachtte. Die aanvraag is ingetrokken.'
          : `Deze wijziging vervangt ${superseded.length} eerdere aanvragen die nog op een beslissing van ABB wachtten. Die aanvragen zijn ingetrokken.`,
        'Eerdere aanvraag vervangen',
      );
    }

    return saved;
  }

  /**
   * Bring the store back to the backend's state after a request the service
   * recorded without applying it, so that the page shows the current values:
   * the local changes are discarded, the new records, which exist in the
   * request only, are unloaded, and the persisted records are reloaded with
   * the relationships the request changed. A conflict is always about a key
   * the request changed, so these include every relationship in conflict.
   */
  async reloadUnapplied(serializer, records) {
    // Decide what to reload while the local state still tells what changed
    const reloads = records
      .filter((record) => !record.isNew)
      .map((record) => ({
        type: record.constructor.modelName,
        id: record.id,
        include: changedRelationshipKeys(serializer, this.store.cache, record),
      }));

    for (const record of records) {
      if (!record.isNew) {
        this.store.cache.rollbackRelationships(recordIdentifierFor(record));
      }
      // Unloads a new record, restores one whose deletion was pending
      record.rollbackAttributes();
    }

    await Promise.all(
      reloads.map(({ type, id, include }) => this.refetch(type, id, include)),
    );
  }

  /**
   * Fetch a record from the backend with the given relationships included.
   *
   * @param {string} type - model name
   * @param {string} id
   * @param {string[]} include - relationship keys, as the API names them
   * @returns {Promise<Model>}
   */
  async refetch(type, id, include) {
    const options = { reload: true };
    if (include.length > 0) {
      options.include = include.join(',');
    }
    const { content } = await this.store.request(findRecord(type, id, options));
    return content;
  }

  /**
   * Withdraw a request the service holds for a decision by ABB: an
   * intrekking step (`POST /change-requests/:id/steps`). A user who enters
   * the change again makes a second request next to the held one; if ABB
   * approved the held one later, it would replace what the second one
   * applied. Resolves once the request is withdrawn, also when it was
   * withdrawn already; rejects with a `ChangeRequestError` whose message
   * says why it is not (ABB decided on it meanwhile, the session may not
   * withdraw it, it did not reach the service, ...).
   *
   * @param {string} requestId - uuid of the change request
   */
  async withdraw(requestId) {
    const response = await this.takeStep(
      requestId,
      'intrekking',
      'De intrekking kon niet verstuurd worden. Controleer de verbinding en probeer opnieuw.',
    );
    if (response.ok) {
      return;
    }

    const error = await ChangeRequestError.fromResponse(
      response,
      withdrawMessage,
    );
    if (error.status === 409 && requestStatusOf(error.errors) === WITHDRAWN) {
      return;
    }
    throw error;
  }

  /**
   * Apply a request whose apply failed (`ChangeRequestError.applyFailed`)
   * again: a hertoepassing step (`POST /change-requests/:id/steps`) applies
   * its stored versions, which repairs what a half-way apply left. Resolves
   * once the request is applied, also when it was applied meanwhile.
   * Rejects with a `ChangeRequestError`: `applyFailed` when the apply failed
   * once more, `outcomeUnknown` for a 5xx, neither when the step did not
   * reach the service; all of these may be tried again, a request that is
   * applied already is not applied twice. `refused` when the service refuses
   * the step, e.g. because another request on the organisation was applied
   * after this one failed; the message says why, and the page must be
   * reloaded.
   *
   * @param {string} requestId - uuid of the change request
   */
  async reapply(requestId) {
    const response = await this.takeStep(
      requestId,
      'hertoepassing',
      'De wijziging kon niet verstuurd worden. Controleer de verbinding en probeer opnieuw.',
    );
    if (response.ok) {
      return;
    }

    const error = await ChangeRequestError.fromResponse(
      response,
      reapplyMessage,
    );
    // A 409 for a request that is no longer `mislukt` carries its status:
    // `goedgekeurd` when another tab applied it meanwhile.
    if (error.status === 409 && requestStatusOf(error.errors) === APPROVED) {
      return;
    }
    throw error;
  }

  /**
   * POST a step on a request the service kept.
   *
   * @param {string} requestId - uuid of the change request
   * @param {string} stepType - `intrekking`, `hertoepassing`, ...
   * @param {string} unsentMessage - the message when the request does not
   *     reach the service
   * @returns {Promise<Response>}
   */
  takeStep(requestId, stepType, unsentMessage) {
    return post(
      `${ENDPOINT}/${encodeURIComponent(requestId)}/steps`,
      {
        data: {
          type: 'change-request-steps',
          attributes: { 'step-type': stepType },
        },
      },
      unsentMessage,
    );
  }
}

/**
 * One operation of the request: the record as the JSON:API serializer writes
 * it, with the references to new records that the serializer leaves out
 * added back as `lid` references, and for an update the base it starts from.
 */
function serializeOperation(serializer, cache, record, lids) {
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

  if (op === 'update') {
    const base = serializeBase(serializer, cache, snapshot, data);
    if (Object.keys(base).length > 0) {
      data.meta = { base };
    }
  }

  return { op, data };
}

/**
 * The base of an update: for every key the operation carries, the value the
 * record had when it was loaded, which is what the user started from. The
 * service compares it with the proposed and the current value: a key the
 * user left as it was is not written, and a key someone else changed in the
 * meantime is a conflict instead of being overwritten.
 *
 * The cache still has these values: a changed attribute as the old half of
 * its `[old, new]` pair (`changedAttributes`), a changed relationship as its
 * remote state, and an unchanged key as its current value. They are written
 * by the serializer that writes the proposal, through a view of the snapshot
 * that answers with them, so that the base has the keys, the transforms and
 * the resource identifiers of the proposal. The pages load a relationship
 * before they change it, so its remote state is what the server had. A
 * transform can write a changed value in another form than the stored one
 * (`phone` adds "tel:" to a number stored without it); that base is the form
 * the serializer kept when it loaded the record (`loadedForm`).
 *
 * @returns {{ attributes?: Object, relationships?: Object }} the entries for
 *     the carried keys; empty when the operation carries none
 */
function serializeBase(serializer, cache, snapshot, data) {
  const { identifier } = snapshot;
  const changedAttributes = snapshot.changedAttributes();
  const changedRelationships = cache.changedRelationships(identifier);
  const remoteState = (name) => {
    // A to-one the page cleared reads as null in the remote data too; the
    // diff keeps what it was.
    const diff = changedRelationships.get(name);
    return diff
      ? diff.remoteState
      : cache.getRemoteRelationship(identifier, name).data;
  };

  // The part of the snapshot interface the serializer reads per field
  const loaded = {
    modelName: snapshot.modelName,
    attr: (name) =>
      name in changedAttributes
        ? changedAttributes[name][0]
        : snapshot.attr(name),
    belongsTo: (name) => {
      const related = remoteState(name);
      return related ? persistedSnapshot(related) : related;
    },
    hasMany: (name) => remoteState(name)?.map(persistedSnapshot),
  };

  const json = {};
  snapshot.eachAttribute((name, attribute) =>
    serializer.serializeAttribute(loaded, json, name, attribute),
  );
  // A changed attribute whose transform writes the loaded value in another
  // form than the stored one (a telephone number stored without "tel:" or as
  // ""): its base is the stored form, the value the service compares with.
  // An attribute whose value serialises as it was loaded keeps the base the
  // serializer wrote, which equals its proposal: the service does not write
  // it, also when the page only normalised it ("" to null).
  for (const [name, [loadedValue]] of Object.entries(changedAttributes)) {
    const key = serializer.keyForAttribute(name, 'serialize');
    if (
      json.attributes &&
      key in json.attributes &&
      json.attributes[key] !== data.attributes?.[key]
    ) {
      const loadedForm = serializer.loadedForm(
        snapshot.modelName,
        snapshot.id,
        name,
        loadedValue,
      );
      if (loadedForm !== undefined) {
        json.attributes[key] = loadedForm;
      }
    }
  }
  snapshot.eachRelationship((name, relationship) => {
    if (relationship.kind === 'belongsTo') {
      serializer.serializeBelongsTo(loaded, json, relationship);
    } else {
      serializer.serializeHasMany(loaded, json, relationship);
    }
  });

  const base = {};
  const attributes = carried(json.attributes, data.attributes);
  if (attributes) {
    base.attributes = attributes;
  }
  const relationships = carried(json.relationships, data.relationships);
  if (relationships) {
    base.relationships = relationships;
  }
  return base;
}

/**
 * A persisted related record as the serializer reads it from a snapshot.
 */
function persistedSnapshot({ type, id }) {
  return { modelName: type, id, isNew: false };
}

/**
 * The entries of a serialised base for the keys the proposal carries; a key
 * whose proposed value is undefined is not carried, JSON leaves it out. An
 * attribute that had no value at all is null.
 */
function carried(base = {}, proposed = {}) {
  const keys = Object.keys(proposed).filter(
    (key) => proposed[key] !== undefined && key in base,
  );
  if (keys.length === 0) {
    return undefined;
  }
  return Object.fromEntries(keys.map((key) => [key, base[key] ?? null]));
}

/**
 * The relationships of a persisted record that the page changed, as the API
 * names them.
 */
function changedRelationshipKeys(serializer, cache, record) {
  return Array.from(
    cache.changedRelationships(recordIdentifierFor(record)).keys(),
    (name) => serializer.keyForRelationship(name, null, 'serialize'),
  );
}

/**
 * The request a JSON:API error is about (`meta['change-request']`, `{ id,
 * status }`), e.g. the request whose apply failed.
 */
function changeRequestOf(errors) {
  return (
    errors.find((error) => error?.meta?.['change-request'])?.meta[
      'change-request'
    ] ?? null
  );
}

/**
 * The status of the request in the 409 the service answers for a step that
 * its status does not admit (`meta.status`), or null.
 */
function requestStatusOf(errors) {
  return (
    errors.find((error) => typeof error?.meta?.status === 'string')?.meta
      .status ?? null
  );
}

/**
 * The message for a withdrawal the service refused.
 */
function withdrawMessage(status, errors) {
  if (status === 409) {
    switch (requestStatusOf(errors)) {
      case APPROVED:
        return 'ABB heeft je aanvraag intussen goedgekeurd; ze kan niet meer ingetrokken worden.';
      case 'afgekeurd':
        return 'ABB heeft je aanvraag intussen afgekeurd; ze kan niet meer ingetrokken worden.';
      case FAILED:
        return 'ABB heeft je aanvraag intussen goedgekeurd, maar het toepassen ervan mislukte; ze kan niet meer ingetrokken worden.';
      default:
        return 'Je aanvraag kan niet meer ingetrokken worden.';
    }
  }
  if (status === 403) {
    return 'Je mag deze aanvraag niet intrekken.';
  }
  if (status === 404) {
    return 'Je aanvraag werd niet gevonden.';
  }
  return `Je aanvraag kon niet ingetrokken worden (HTTP ${status}). Probeer het opnieuw.`;
}

/**
 * The message for a hertoepassing the service refused, or undefined for the
 * default one: a failed apply (`applyFailed`) and a 5xx.
 */
function reapplyMessage(status, errors) {
  if (status >= 500 || changeRequestOf(errors)?.status === FAILED) {
    return undefined;
  }
  if (status === 409 && changeRequestOf(errors)?.status === APPROVED) {
    return 'Intussen werd een andere wijziging van deze organisatie doorgevoerd, daarom wordt je aanvraag niet meer toegepast. Herlaad de pagina en voer je wijziging opnieuw in.';
  }
  return `Je aanvraag kon niet opnieuw toegepast worden (HTTP ${status}). Herlaad de pagina en voer je wijziging opnieuw in.`;
}

function heldMessage(conflicts) {
  const keys = [...new Set(conflicts.map(({ key }) => key))];
  const reason =
    keys.length > 0
      ? ` omdat iemand anders intussen dezelfde gegevens heeft gewijzigd (${keys.join(', ')})`
      : '';
  return `De wijziging werd niet doorgevoerd${reason}. De aanvraag wacht op een beslissing van ABB.`;
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

async function post(
  url,
  document,
  unsentMessage = 'De wijziging kon niet verstuurd worden. Controleer de verbinding en probeer opnieuw.',
) {
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
    throw new ChangeRequestError(unsentMessage, { cause: error });
  }
}
