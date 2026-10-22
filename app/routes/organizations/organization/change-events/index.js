import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord, query } from '@warp-drive/legacy/compat/builders';
import {
  KIND,
  STATUS,
} from 'frontend-organization-portal/constants/change-requests';

/**
 * The statuses of a request that ABB still has to decide on.
 */
const WAITING_STATUSES = [STATUS.SUBMITTED, STATUS.INFORMATION_REQUESTED];

export default class OrganizationsOrganizationChangeEventsIndexRoute extends Route {
  @service store;
  @service changeRequests;

  queryParams = {
    page: { refreshModel: true },
    size: { refreshModel: true },
    sort: { refreshModel: true },
  };

  async model(params) {
    let { id: organizationId } = this.paramsFor('organizations.organization');

    const { content: changeEventResults } = await this.store.request(
      query('change-event-result', {
        'filter[resulting-organization][:id:]': organizationId,
        include: [
          'result-from.type',
          'status',
          'resulting-organization',
        ].join(),
        page: {
          number: params.page,
          size: params.size,
        },
        sort: params.sort,
      }),
    );

    return {
      organization: this.modelFor('organizations.organization'),
      changeEventResults,
      pendingRequests: await this.loadPendingRequests(organizationId),
    };
  }

  /**
   * The change-event requests about the organisation that are not applied
   * yet: those that wait for ABB, and those ABB rejected, which the
   * requester can still contest. They are shown with the events, as the
   * designs ask, each with the type and date of the event it proposes. An
   * empty list when the service does not answer: the events are shown all
   * the same.
   *
   * @returns {Promise<Array<{ request: Object, eventType: Model|null, eventDate: string|null, waiting: boolean }>>}
   */
  async loadPendingRequests(organizationId) {
    let requests;
    try {
      ({ requests } = await this.changeRequests.list({
        target: organizationId,
        kind: KIND.CHANGE_EVENT,
        status: [...WAITING_STATUSES, STATUS.REJECTED].join(','),
        size: 100,
      }));
    } catch (error) {
      console.warn(
        'The pending change-event requests could not be loaded:',
        error,
      );
      return [];
    }
    return Promise.all(requests.map((request) => this.withEvent(request)));
  }

  /**
   * A request with the change event it proposes, from its operations: the
   * listing does not carry them, so the request is read. Without its event
   * when that fails: the request is shown all the same. `waiting` is false
   * for a rejected request.
   */
  async withEvent(request) {
    const waiting = WAITING_STATUSES.includes(request.attributes?.status);
    try {
      const { attributes } = await this.changeRequests.find(request.id);
      const event = (attributes.operations ?? []).find(
        (operation) => operation?.data?.type === 'change-events',
      )?.data;
      const typeId = event?.relationships?.type?.data?.id;
      const eventType = typeId
        ? (await this.store.request(findRecord('change-event-type', typeId)))
            .content
        : null;
      return {
        request,
        eventType,
        eventDate: event?.attributes?.date ?? null,
        waiting,
      };
    } catch (error) {
      console.warn(`The request ${request.id} could not be read:`, error);
      return { request, eventType: null, eventDate: null, waiting };
    }
  }
}
