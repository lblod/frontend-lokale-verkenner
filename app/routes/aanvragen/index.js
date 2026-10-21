import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { keepLatestTask } from 'ember-concurrency';
import { query } from '@warp-drive/legacy/compat/builders';
import { LISTED_KINDS } from 'frontend-organization-portal/constants/change-requests';

/**
 * The list of change requests ("Alle aanvragen"): the page the service
 * answers for the filters, with the organisations and classifications it
 * names resolved to records. The service lists creations and change events;
 * edits, which apply at once, are history only (a request page still shows
 * one).
 */
export default class AanvragenIndexRoute extends Route {
  @service changeRequests;
  @service muSearch;
  @service store;

  queryParams = {
    page: { refreshModel: true },
    sort: { refreshModel: true },
    kind: { refreshModel: true, replace: true },
    mine: { refreshModel: true, replace: true },
    requester: { refreshModel: true, replace: true },
    organization: { refreshModel: true, replace: true },
    targetClassification: { refreshModel: true, replace: true },
    status: { refreshModel: true, replace: true },
    createdFrom: { refreshModel: true, replace: true },
    createdUntil: { refreshModel: true, replace: true },
  };

  model(params) {
    return {
      loadRequestsTaskInstance: this.loadRequestsTask.perform(params),
      loadedRequests: this.loadRequestsTask.lastSuccessful?.value,
    };
  }

  loadRequestsTask = keepLatestTask(async (params) => {
    const page = Number(params.page) || 0;
    const size = Number(params.size) || 20;
    const { requests, count } = await this.changeRequests.list({
      // A kind the page does not offer (`edit`, from an old link) is no
      // filter
      kind: LISTED_KINDS.includes(params.kind) ? params.kind : undefined,
      mine: params.mine === true || params.mine === 'true',
      requester: params.requester || undefined,
      target: params.organization || undefined,
      targetClassification: params.targetClassification || undefined,
      status: params.status || undefined,
      createdFrom: startOfDay(params.createdFrom),
      createdUntil: endOfDay(params.createdUntil),
      sort: params.sort || undefined,
      page,
      size,
    });
    const rows = await this.rowsFor(requests);
    // AuDataTable reads the total and the pager's links from the content's
    // meta, in the shape mu-search gives them
    rows.meta = {
      count,
      pagination: this.muSearch.getPaginationMetadata(page, size, count),
    };
    return rows;
  });

  setupController(controller) {
    super.setupController(...arguments);
    // The filters' selects show records; the URL names their uuids
    controller.loadSelectedRecords.perform();
  }

  /**
   * One row per request, with the requesting organisation and the
   * classification of the organisation the request is about as records.
   */
  async rowsFor(requests) {
    const requesterIds = unique(
      requests.map(
        (request) =>
          request.relationships?.['requesting-organisation']?.data?.id,
      ),
    );
    const classificationIds = unique(
      requests.map((request) => request.attributes['target-classification']),
    );
    const [requesters, classifications] = await Promise.all([
      this.recordsByIds('organization', requesterIds),
      this.recordsByIds('organization-classification-code', classificationIds),
    ]);

    return requests.map((request) => {
      const { attributes, relationships } = request;
      const requesterId = relationships?.['requesting-organisation']?.data?.id;
      const target = relationships?.target;
      return {
        id: request.id,
        kind: attributes.kind,
        status: attributes.status,
        created: attributes.created,
        mine: attributes.mine === true,
        requester: requesters.get(requesterId) ?? null,
        requesterId,
        targetId: target?.data?.id ?? null,
        // A creation whose organisation is not registered: one that still
        // waits, or one that was rejected, withdrawn or failed
        targetPending: target?.meta?.pending === true,
        targetUnregistered: target?.meta?.registered === false,
        targetName: attributes['target-name'],
        classification:
          classifications.get(attributes['target-classification']) ?? null,
      };
    });
  }

  /**
   * Records by id, as a Map; an id the backend does not know is left out.
   */
  async recordsByIds(modelName, ids) {
    if (ids.length === 0) {
      return new Map();
    }
    const { content } = await this.store.request(
      query(modelName, {
        filter: { id: ids.join(',') },
        page: { size: ids.length },
      }),
    );
    return new Map(content.map((record) => [record.id, record]));
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * The first moment of a day given as `YYYY-MM-DD` (local time), as the
 * service's `filter[created][gte]` takes it.
 */
export function startOfDay(day) {
  if (!day) {
    return undefined;
  }
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The last moment of a day given as `YYYY-MM-DD` (local time).
 */
export function endOfDay(day) {
  if (!day) {
    return undefined;
  }
  const date = new Date(`${day}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
