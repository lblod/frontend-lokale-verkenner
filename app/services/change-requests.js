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
 * The statuses of an applied request (`afgehandeld`; `goedgekeurd` is the
 * decision that precedes the apply, recorded in the same update), of a
 * withdrawn one and of a rejected one.
 */
const APPLIED = 'afgehandeld';
const APPROVED = 'goedgekeurd';
const WITHDRAWN = 'ingetrokken';
const REJECTED = 'afgekeurd';

const APPLY_FAILED_MESSAGE =
  'De wijziging kon niet doorgevoerd worden: het toepassen ervan mislukte. Je aanvraag is bewaard. Herlaad de pagina en controleer de gegevens voor je opnieuw opslaat.';
/**
 * A submit that got no answer, or one that cannot be read: it may have been
 * applied or recorded all the same.
 */
const UNANSWERED_MESSAGE =
  'De wijziging kon niet verstuurd worden, of het antwoord van de dienst kwam niet aan: ze is mogelijk toch doorgevoerd. Herlaad de pagina en controleer of de wijziging is doorgevoerd voor je opnieuw opslaat.';
const UNREADABLE_ANSWER_MESSAGE =
  'De dienst antwoordde, maar het antwoord kon niet gelezen worden: de wijziging is mogelijk doorgevoerd. Herlaad de pagina en controleer of de wijziging is doorgevoerd voor je opnieuw opslaat.';
const UNREADABLE_LIST_MESSAGE =
  'Het antwoord van de dienst kon niet gelezen worden. Herlaad de pagina en probeer opnieuw.';

/**
 * A change request the service refused (403, 422), could not apply (409),
 * held for a decision instead of applying it, that never reached it, or that
 * was applied but could not be followed up in the browser. `message` is meant
 * for the user; `errors` is the JSON:API errors array of the response, when
 * there was one; `requestId` is the uuid of the request the service kept, for
 * a held request, for one whose apply failed and for one that was applied
 * but could not be followed up.
 *
 * The flags tell the page what to do with its dirty state:
 * - `applied`: the service answered 2xx, so the change is in the application
 *   graph; the page must not offer a retry (it would apply the change twice)
 *   but leave and reload.
 * - `held`: nothing is applied and the submitted records are back at the
 *   backend's state. Either the service refused an edit because someone
 *   else changed the same data since the page loaded it (a 409 with the
 *   conflicts; `waiting` is false and `requestId` null: nothing was
 *   recorded), or it recorded a request that waits for a decision by ABB (a
 *   201 with status `ingediend`, for a request to register a new
 *   organisation or a veranderingsgebeurtenis; `waiting` is true and
 *   `requestId` the uuid of the request, which `withdraw` can withdraw).
 *   `conflicts` lists the fields as the service reports them (`{ resource:
 *   { type, id }, key, base, current, proposed, 'competing-requests' }`).
 *   `submit` has discarded the local changes and reloaded the records; the
 *   page rebuilds its form from them, so that it shows the current values,
 *   and tells the user which fields were changed meanwhile. `reloadFailed`
 *   is set when the records could not be reloaded (`cause` is the error):
 *   the store then holds the values the page loaded, not the current ones,
 *   so a new save would start from stale values and the page blocks it
 *   until it is reloaded.
 * - `applyFailed`: a 409 for a request whose apply failed twice: the service
 *   kept it with status `mislukt`, and the apply may have stopped half-way,
 *   leaving the keys it changes empty on the master. A new request would
 *   start from the values the page loaded and conflict with that state, so
 *   the page blocks saving and links to the kept request (`requestId`).
 * - `outcomeUnknown`: a 5xx; the service may have applied the request before
 *   the dispatcher or the service itself gave up (e.g. a gateway timeout
 *   after the one-transaction apply). The same when a submit got no answer
 *   (the request may have reached the service before the connection broke)
 *   or an answer that cannot be read. A retry could duplicate the change, so
 *   the page blocks it until it is reloaded.
 * - none: the service refused (4xx) or a step never left; the page keeps its
 *   edits for a correction and a retry.
 */
export class ChangeRequestError extends Error {
  /**
   * Whether the outcome is unknown for another reason than a 5xx, see
   * `outcomeUnknown`.
   */
  #unanswered;

  constructor(
    message,
    {
      status = null,
      errors = [],
      applied = false,
      held = false,
      waiting = false,
      conflicts = [],
      reloadFailed = false,
      applyFailed = false,
      requestId = null,
      conflictsToken = null,
      outcomeUnknown = false,
      cause,
    } = {},
  ) {
    super(message, { cause });
    this.name = 'ChangeRequestError';
    this.status = status;
    this.errors = errors;
    this.applied = applied;
    this.held = held;
    this.waiting = waiting;
    this.conflicts = conflicts;
    this.reloadFailed = reloadFailed;
    this.applyFailed = applyFailed;
    this.requestId = requestId;
    this.conflictsToken = conflictsToken;
    this.#unanswered = outcomeUnknown;
  }

  get outcomeUnknown() {
    return (
      !this.applied &&
      (this.#unanswered || (this.status !== null && this.status >= 500))
    );
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
      // A goedkeuring refused over changed data carries the conflicts and
      // the token that overrides exactly them
      conflicts: conflictsOf(errors) ?? [],
      conflictsToken: conflictsTokenOf(errors),
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
   * What the session may do with requests in general, as `loadRights`
   * fetched it: `{ canDecide, canCreate }`, `canDecide` whether it approves,
   * rejects and asks for information (ABB), `canCreate` the classifications
   * (URIs) of the organisations it may request. Null until loaded.
   */
  @tracked rights = null;

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
   * Ask the service what the session may do with requests in general
   * (`GET /change-requests/permissions` without target) and keep the answer
   * as `rights`. When the check fails the session decides nothing and may
   * request nothing, as for `permissions`.
   *
   * @returns {Promise<{ canDecide: boolean, canCreate: string[] }>}
   */
  async loadRights() {
    const nothing = { canDecide: false, canCreate: [] };
    let body;
    try {
      const response = await fetch(`${ENDPOINT}/permissions`, {
        headers: { Accept: JSON_API_CONTENT_TYPE },
      });
      if (!response.ok) {
        console.warn(
          `Could not determine the rights on change requests (HTTP ${response.status}).`,
        );
        this.rights = nothing;
        return nothing;
      }
      body = await response.json();
    } catch (error) {
      console.warn('Could not determine the rights on change requests.', error);
      this.rights = nothing;
      return nothing;
    }
    this.rights = {
      canDecide: body?.['can-decide'] === true,
      canCreate: Array.isArray(body?.['can-create']) ? body['can-create'] : [],
    };
    return this.rights;
  }

  /**
   * One page of the change requests the session may see
   * (`GET /change-requests`): the JSON:API documents as the service answers
   * them, the total over all pages and the pagination links. Oldest first
   * unless `sort` says otherwise.
   *
   * @param {Object} [filters]
   * @param {string} [filters.kind] - `edit`, `creation` or `change-event`
   *     (comma-separated for several)
   * @param {boolean} [filters.mine] - only the requests the session's person
   *     submitted
   * @param {string} [filters.requester] - uuid of the requesting organisation
   * @param {string} [filters.target] - uuid of the organisation the request
   *     is about
   * @param {string} [filters.targetClassification] - uuid of a
   *     classification code
   * @param {string} [filters.status] - status keys, comma-separated
   * @param {string} [filters.createdFrom] - ISO date-time, inclusive
   * @param {string} [filters.createdUntil] - ISO date-time, inclusive
   * @param {string} [filters.sort] - `created` (the default) or `-created`
   * @param {number} [filters.page] - from 0
   * @param {number} [filters.size] - at most 100
   * @returns {Promise<{ requests: Object[], count: number, links: Object }>}
   */
  async list({
    kind,
    mine = false,
    requester,
    target,
    targetClassification,
    status,
    createdFrom,
    createdUntil,
    sort,
    page = 0,
    size = 20,
  } = {}) {
    const query = new URLSearchParams();
    if (kind) query.set('filter[kind]', kind);
    if (mine) query.set('filter[mine]', 'true');
    if (requester) query.set('filter[requester]', requester);
    if (target) query.set('filter[target]', target);
    if (targetClassification) {
      query.set('filter[target-classification]', targetClassification);
    }
    if (status) query.set('filter[status]', status);
    if (createdFrom) query.set('filter[created][gte]', createdFrom);
    if (createdUntil) query.set('filter[created][lte]', createdUntil);
    if (sort) query.set('sort', sort);
    query.set('page[number]', String(page));
    query.set('page[size]', String(size));

    const response = await get(
      `${ENDPOINT}?${query}`,
      'De aanvragen konden niet opgehaald worden. Controleer de verbinding en probeer opnieuw.',
    );
    if (!response.ok) {
      throw await ChangeRequestError.fromResponse(response, listMessage);
    }
    const body = await jsonOf(response);
    if (body === undefined) {
      throw new ChangeRequestError(UNREADABLE_LIST_MESSAGE, {
        status: response.status,
      });
    }
    return {
      requests: Array.isArray(body?.data) ? body.data : [],
      count: body?.meta?.count ?? 0,
      links: body?.links ?? {},
    };
  }

  /**
   * One change request (`GET /change-requests/:id`): its JSON:API document,
   * with its steps, live conflicts and the operations it was submitted with.
   * Rejects with a `ChangeRequestError` when it does not exist or is not
   * visible to the session (404), or the service does not answer.
   *
   * @param {string} requestId - uuid of the change request
   * @returns {Promise<Object>} the resource object (`id`, `attributes`,
   *     `relationships`)
   */
  async find(requestId) {
    const response = await get(
      `${ENDPOINT}/${encodeURIComponent(requestId)}`,
      'De aanvraag kon niet opgehaald worden. Controleer de verbinding en probeer opnieuw.',
    );
    if (!response.ok) {
      throw await ChangeRequestError.fromResponse(response, findMessage);
    }
    const body = await jsonOf(response);
    if (!body?.data?.id) {
      throw new ChangeRequestError(
        'Het antwoord van de dienst bevat geen aanvraag.',
        { status: response.status },
      );
    }
    return body.data;
  }

  /**
   * Take a step on a request (`POST /change-requests/:id/steps`): a
   * goedkeuring, afkeuring or informatievraag by ABB, an informatieantwoord
   * or betwisting by the requesting organisation, an intrekking, or a
   * hertoepassing of a failed request. Resolves with the updated request
   * document. Rejects with a `ChangeRequestError` whose message says why the
   * service refused: the status no longer admits the step (409), a
   * goedkeuring over data that changed meanwhile (409 with `conflicts` and
   * the `conflictsToken` that overrides exactly them), the session may not
   * take it (403), a missing text (422), or the step did not reach the
   * service.
   *
   * @param {string} requestId - uuid of the change request
   * @param {string} stepType - `goedkeuring`, `afkeuring`, `informatievraag`,
   *     `informatieantwoord`, `betwisting`, `intrekking` or `hertoepassing`
   * @param {Object} [options]
   * @param {string|null} [options.reason] - the text of the step: the
   *     question, the answer, the reason of a rejection or a contest
   * @param {string|null} [options.override] - the conflicts token of the
   *     conflicts reviewed, for a goedkeuring that overrides them
   * @returns {Promise<Object>} the updated resource object
   */
  async takeDecision(
    requestId,
    stepType,
    { reason = null, override = null } = {},
  ) {
    const attributes = { 'step-type': stepType };
    if (reason) attributes.reason = reason;
    if (override) attributes.override = override;
    const response = await post(
      `${ENDPOINT}/${encodeURIComponent(requestId)}/steps`,
      { data: { type: 'change-request-steps', attributes } },
      'De stap kon niet verstuurd worden. Controleer de verbinding en probeer opnieuw.',
    );
    if (!response.ok) {
      throw await ChangeRequestError.fromResponse(response, stepMessage);
    }
    // The step is taken; an answer that cannot be read only means the page
    // reloads the request instead of showing the answer
    const body = await jsonOf(response);
    return body?.data ?? null;
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
   * When the service applied the request (201, status `afgehandeld`) the
   * local changes are discarded and every record is reloaded from the
   * backend: the persisted ones with the relationships the request changed,
   * the new ones under the uuids the service minted (the client-side new
   * records are unloaded). When it refused a stale edit (409 with the
   * conflicts) or held a request for ABB (201, status `ingediend`) the
   * local changes are discarded too, the new records unloaded and the
   * persisted ones reloaded, and a `ChangeRequestError` with `held` set
   * carries the conflicts, whether a request waits for ABB (`waiting`) and
   * its id. On another refusal (4xx) nothing is touched, so the page keeps
   * its dirty state, and a `ChangeRequestError` carries the message of the
   * service; a 409 for an apply that failed has `applyFailed` set and the
   * id of the kept request (`requestId`). An error after the service
   * applied the request (the answer lacks the id of a new record, a reload
   * fails) is a `ChangeRequestError` with `applied` set and the id of the
   * request: the change is in the application graph, the page must leave
   * and reload instead of retrying. When the request changes nothing the
   * service holds (200 with `meta.unchanged`), the service stores nothing;
   * the local changes are discarded and the records reloaded as after an
   * applied request. No answer at all, or one that cannot be read, is a
   * `ChangeRequestError` with `outcomeUnknown` set: the request may have
   * been applied or recorded.
   *
   * A relationship the page changed without having loaded its value from
   * the backend has no base the service could compare with, so `submit`
   * throws (an `Error`, not a `ChangeRequestError`) before anything is
   * sent; see `serializeBase`.
   *
   * @param {string} aggregate - name of the aggregate, e.g. `organization-core-data`
   * @param {string|null} target - uuid of the organisation the request is
   *     about; null for a request that registers a new organisation, which
   *     has no target yet
   * @param {Model[]} records - the records of the aggregate, dependencies first
   * @param {Object} [options]
   * @param {string|null} [options.reason] - the submitter's explanation, kept
   *     on the request and shown to ABB
   * @returns {Promise<Map<Model, Model|null>>} for every submitted record the
   *     reloaded record (a fresh record for the new ones, null for the deleted
   *     ones)
   */
  async submit(aggregate, target, records, { reason = null } = {}) {
    const lids = new Map(
      records
        .filter((record) => record.isNew)
        .map((record) => [record, uuid()]),
    );
    const operations = records.map((record) =>
      serializeOperation(
        this.serializerFor(record),
        this.store.cache,
        record,
        lids,
      ),
    );

    const requestAttributes = { aggregate, operations };
    if (reason) {
      requestAttributes.reason = reason;
    }
    const document = {
      data: { type: 'change-requests', attributes: requestAttributes },
    };
    if (target) {
      document.data.relationships = {
        target: { data: { type: 'organizations', id: target } },
      };
    }
    // A request that got no answer may have reached the service all the
    // same: the connection can break after the request was sent.
    const response = await post(ENDPOINT, document, UNANSWERED_MESSAGE, {
      outcomeUnknown: true,
    });

    if (!response.ok) {
      const error = await ChangeRequestError.fromResponse(response);
      const conflicts = conflictsOf(error.errors);
      if (response.status === 409 && conflicts) {
        // A stale edit: someone else changed the same data since the page
        // loaded it. The service refused it without recording anything, so
        // the page shows the current values and the user saves again.
        throw await this.unapplied(records, {
          status: response.status,
          errors: error.errors,
          conflicts,
          waiting: false,
          requestId: null,
        });
      }
      throw error;
    }

    const body = await jsonOf(response);
    if (body === undefined) {
      // The service answered, but what it did cannot be told
      throw new ChangeRequestError(UNREADABLE_ANSWER_MESSAGE, {
        status: response.status,
        outcomeUnknown: true,
      });
    }
    const attributes = body?.data?.attributes ?? {};
    const requestId = body?.data?.id ?? null;
    // Nothing is stored: the request changes nothing the service holds
    const unchanged = body?.meta?.unchanged === true;

    if (attributes.status === SUBMITTED) {
      // Recorded, not applied: the request waits for a decision by ABB
      throw await this.unapplied(records, {
        status: response.status,
        conflicts: Array.isArray(attributes.conflicts)
          ? attributes.conflicts
          : [],
        waiting: true,
        requestId,
      });
    }

    const mintedIds = attributes.lids ?? {};

    // Check before touching the store: without its uuid a new record cannot
    // be reloaded and the page would lose it. An unchanged request has no
    // new records: a create always changes something.
    for (const [record, lid] of lids) {
      if (!unchanged && !mintedIds[lid]) {
        throw new ChangeRequestError(
          `De wijziging is doorgevoerd, maar het antwoord bevat geen id voor de nieuwe ${record.constructor.modelName} (lid ${lid}). Herlaad de pagina om de nieuwe gegevens te zien.`,
          { status: response.status, applied: true, requestId },
        );
      }
    }

    // Decide what to reload while the local state still tells what changed
    const reloads = records.map((record, index) => ({
      record,
      type: record.constructor.modelName,
      id: record.isNew ? (mintedIds[lids.get(record)] ?? null) : record.id,
      isDeleted: record.isDeleted,
      include: record.isNew
        ? Object.keys(operations[index].data.relationships ?? {})
        : changedRelationshipKeys(
            this.serializerFor(record),
            this.store.cache,
            record,
          ),
    }));

    // The service applied the request, or found nothing to change: the
    // backend is now the truth
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
            isDeleted || id === null
              ? null
              : await this.refetch(type, id, include),
          );
        }),
      );
    } catch (error) {
      // The change is applied; only the store is half reloaded. The page
      // leaves and reloads instead of retrying, which would apply it twice.
      throw new ChangeRequestError(
        'De wijziging is doorgevoerd, maar de pagina kon niet vernieuwd worden. Herlaad de pagina om de nieuwe gegevens te zien.',
        { status: response.status, applied: true, requestId, cause: error },
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
   * Whether submitting the records would change anything: a new or a
   * deleted record does, an update only when a key it carries differs from
   * the value the record was loaded with (its base, see `serializeBase`).
   * The edit pages leave without a request when nothing changed, rather
   * than send one the service only answers with `meta.unchanged`. Throws as
   * `submit` does for a relationship whose value was never loaded.
   *
   * @param {Model[]} records - the records `submit` would get
   * @returns {boolean}
   */
  hasChanges(records) {
    const lids = new Map(
      records
        .filter((record) => record.isNew)
        .map((record) => [record, uuid()]),
    );
    return records.some((record) => {
      const { op, data } = serializeOperation(
        this.serializerFor(record),
        this.store.cache,
        record,
        lids,
      );
      return op !== 'update' || !proposesItsBase(data);
    });
  }

  /**
   * The error for a save the service did not apply: the store is brought
   * back to the backend's state (`reloadUnapplied`) and the `held` error
   * built, with `reloadFailed` set when that failed.
   *
   * @returns {Promise<ChangeRequestError>}
   */
  async unapplied(
    records,
    { status, errors = [], conflicts, waiting, requestId },
  ) {
    let cause;
    try {
      await this.reloadUnapplied(records);
    } catch (error) {
      // Still nothing is applied, but the store now holds the values the
      // page loaded instead of the current ones, and a new save would
      // start from them: the page asks for a reload.
      console.error(
        'The records of an unapplied change request could not be reloaded:',
        error,
      );
      cause = error;
    }
    return new ChangeRequestError(heldMessage(conflicts, waiting), {
      status,
      errors,
      held: true,
      waiting,
      conflicts,
      requestId,
      reloadFailed: cause !== undefined,
      cause,
    });
  }

  /**
   * Bring the store back to the backend's state after a save the service
   * did not apply, so that the page shows the current values:
   * the local changes are discarded, the new records, which exist in the
   * request only, are unloaded, and the persisted records are reloaded with
   * the relationships the request changed. A conflict is always about a key
   * the request changed, so these include every relationship in conflict.
   */
  async reloadUnapplied(records) {
    // Decide what to reload while the local state still tells what changed
    const reloads = records
      .filter((record) => !record.isNew)
      .map((record) => ({
        type: record.constructor.modelName,
        id: record.id,
        include: changedRelationshipKeys(
          this.serializerFor(record),
          this.store.cache,
          record,
        ),
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
   * The serializer of a record: the one of its model when it has one (a
   * change event writes its results), else the application's.
   */
  serializerFor(record) {
    const owner = getOwner(this);
    return (
      owner.lookup(`serializer:${record.constructor.modelName}`) ??
      owner.lookup('serializer:application')
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
 * the resource identifiers of the proposal. A transform can write a changed
 * value in another form than the stored one (`phone` adds "tel:" to a
 * number stored without it); that base is the form the serializer kept when
 * it loaded the record (`loadedForm`).
 *
 * The remote state of a relationship is what the server had only when its
 * value was loaded: the backend sends a relationship that was not included
 * as a link, which the store reads as nothing, or as empty for a
 * synchronous one. A page that changes such a relationship would send an
 * empty base, and the service would see a conflict that is none or add to a
 * list instead of replacing it. So a relationship the record keeps itself
 * (one without inverse, as every relationship the pages set) that the page
 * changed but never loaded (`relationshipLoaded` of the serializer) throws
 * before anything is sent: the page must load it first. A relationship with
 * an inverse also changes through its other side (an organisation's change
 * events follow the organisations of a new change event); the service keeps
 * such a link on one side and ignores the other.
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
    if (
      changedRelationships.has(name) &&
      relationship.options?.inverse === null &&
      !serializer.relationshipLoaded?.(snapshot.modelName, snapshot.id, name)
    ) {
      throw new Error(
        `The ${snapshot.modelName} ${snapshot.id} changes its relationship "${name}", whose value was never loaded from the backend: the change request cannot carry the value the server has as its base. Load the relationship before the page changes it.`,
      );
    }
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
 * Whether an update proposes, for every key it carries, the value it
 * started from (`meta.base`), so that it changes nothing. A key without a
 * base counts as a change. Lists (a to-many, a string set) compare as sets,
 * as the service merges them; a reference to a new record (`lid`) never
 * equals a base.
 */
function proposesItsBase({ attributes = {}, relationships = {}, meta }) {
  const base = meta?.base ?? {};
  const sameAttributes = Object.entries(attributes).every(
    ([key, value]) =>
      value === undefined ||
      (key in (base.attributes ?? {}) &&
        sameValue(value, base.attributes[key])),
  );
  const sameRelationships = Object.entries(relationships).every(
    ([key, value]) =>
      key in (base.relationships ?? {}) &&
      sameValue(value?.data ?? null, base.relationships[key]?.data ?? null),
  );
  return sameAttributes && sameRelationships;
}

function sameValue(proposed, base) {
  if (Array.isArray(proposed) || Array.isArray(base)) {
    if (!Array.isArray(proposed) || !Array.isArray(base)) {
      return false;
    }
    const keys = (values) => JSON.stringify(values.map(valueKey).sort());
    return keys(proposed) === keys(base);
  }
  return valueKey(proposed) === valueKey(base);
}

/**
 * A value as `sameValue` compares it: a resource identifier by type and id
 * (or lid), anything else by its JSON.
 */
function valueKey(value) {
  if (value && typeof value === 'object' && 'type' in value) {
    return value.lid ? `lid:${value.lid}` : `${value.type}:${value.id}`;
  }
  return JSON.stringify(value ?? null);
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
 * The conflicts of a 409 for a stale edit (`meta.conflicts` of the error),
 * or null when the error is not one.
 */
function conflictsOf(errors) {
  return (
    errors.find((error) => Array.isArray(error?.meta?.conflicts))?.meta
      .conflicts ?? null
  );
}

/**
 * The conflicts token of a 409 for a goedkeuring over changed data
 * (`meta['conflicts-token']` of the error), or null.
 */
function conflictsTokenOf(errors) {
  return (
    errors.find((error) => typeof error?.meta?.['conflicts-token'] === 'string')
      ?.meta['conflicts-token'] ?? null
  );
}

/**
 * The message for a listing the service refused.
 */
function listMessage(status) {
  if (status === 400) {
    return 'De filters zijn ongeldig. Herstel de filters en probeer opnieuw.';
  }
  if (status === 401) {
    return 'Je bent niet aangemeld.';
  }
  return undefined;
}

/**
 * The message for a request that could not be fetched. The service answers
 * 404 for a request that is not visible to the session as well.
 */
function findMessage(status) {
  if (status === 404) {
    return 'De aanvraag werd niet gevonden.';
  }
  if (status === 401) {
    return 'Je bent niet aangemeld. Meld je opnieuw aan om de aanvraag te bekijken.';
  }
  if (status === 403) {
    return 'Je mag deze aanvraag niet bekijken.';
  }
  return `De aanvraag kon niet opgehaald worden (HTTP ${status}). Probeer het later opnieuw.`;
}

/**
 * The message for a KBO number the service refuses (a 409 with
 * `meta["kbo-number"]`): registered already (`meta.organisation`, the
 * organisation that holds it), or proposed by a creation that waits
 * (`meta["change-request"]`). Null for any other error.
 *
 * @param {Object[]} [errors] - the JSON:API errors of the answer
 * @returns {string|null}
 */
export function kboConflictMessage(errors = []) {
  const error = errors.find((candidate) => candidate?.meta?.['kbo-number']);
  if (!error) {
    return null;
  }
  return error.meta.organisation
    ? 'Er bestaat al een organisatie met dit KBO-nummer.'
    : 'Er wacht al een aanvraag voor een organisatie met dit KBO-nummer.';
}

/**
 * The message for a step the service refused.
 */
function stepMessage(status, errors) {
  if (status === 409) {
    if (conflictsOf(errors)) {
      return 'De gegevens zijn intussen gewijzigd; bekijk de verschillen voor je de aanvraag goedkeurt.';
    }
    // The KBO number of a creation is checked again before it is approved,
    // applied again or contested
    const kboMessage = kboConflictMessage(errors);
    if (kboMessage) {
      return `${kboMessage} Deze aanvraag kan daarom niet doorgevoerd worden.`;
    }
    if (changeRequestOf(errors)?.status === FAILED) {
      return 'Het doorvoeren van de aanvraag mislukte. De aanvraag is bewaard met status "Mislukt".';
    }
    const requestStatus = requestStatusOf(errors);
    if (requestStatus) {
      return `Deze stap is niet meer mogelijk: de aanvraag is intussen ${STATUS_WORDS[requestStatus] ?? requestStatus}.`;
    }
    return 'Deze stap is niet meer mogelijk. Herlaad de pagina.';
  }
  if (status === 403) {
    return 'Je mag deze stap niet zetten.';
  }
  if (status === 404) {
    return 'De aanvraag werd niet gevonden.';
  }
  return undefined;
}

/**
 * The statuses as the step messages name them.
 */
const STATUS_WORDS = {
  ingediend: 'opnieuw ingediend',
  'informatie-gevraagd': 'in afwachting van informatie',
  goedgekeurd: 'goedgekeurd',
  afgehandeld: 'goedgekeurd en doorgevoerd',
  afgekeurd: 'afgekeurd',
  ingetrokken: 'ingetrokken',
  mislukt: 'goedgekeurd, maar het doorvoeren mislukte',
};

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
      case APPLIED:
      case APPROVED:
        return 'ABB heeft je aanvraag intussen goedgekeurd; ze kan niet meer ingetrokken worden.';
      case REJECTED:
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
 * The message of a save the service did not apply: a request that waits for
 * ABB, or a stale edit the service refused.
 */
function heldMessage(conflicts, waiting) {
  const keys = [...new Set(conflicts.map(({ key }) => key))];
  const reason =
    keys.length > 0
      ? ` omdat iemand anders intussen dezelfde gegevens heeft gewijzigd (${keys.join(', ')})`
      : '';
  const next = waiting
    ? 'De aanvraag wacht op een beslissing van ABB.'
    : 'Het formulier toont nu de huidige gegevens; voer je wijziging opnieuw in.';
  return `De wijziging werd niet doorgevoerd${reason}. ${next}`;
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

/**
 * GET a document of the service.
 *
 * @param {string} url
 * @param {string} unsentMessage - the message when the request does not
 *     reach the service
 * @returns {Promise<Response>}
 */
async function get(url, unsentMessage) {
  try {
    return await fetch(url, { headers: { Accept: JSON_API_CONTENT_TYPE } });
  } catch (error) {
    throw new ChangeRequestError(unsentMessage, { cause: error });
  }
}

/**
 * POST a document to the service.
 *
 * @param {string} url
 * @param {Object} document
 * @param {string} unsentMessage - the message when no answer comes
 * @param {Object} [options]
 * @param {boolean} [options.outcomeUnknown] - whether a POST without answer
 *     may have been carried out all the same: true for one that a retry
 *     could duplicate; a step is refused once its request moved on
 * @returns {Promise<Response>}
 */
async function post(
  url,
  document,
  unsentMessage = 'De wijziging kon niet verstuurd worden. Controleer de verbinding en probeer opnieuw.',
  { outcomeUnknown = false } = {},
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
    throw new ChangeRequestError(unsentMessage, {
      cause: error,
      outcomeUnknown,
    });
  }
}

/**
 * The JSON body of an answer, or undefined when it has none that parses (an
 * empty body, the HTML of a proxy).
 */
async function jsonOf(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
