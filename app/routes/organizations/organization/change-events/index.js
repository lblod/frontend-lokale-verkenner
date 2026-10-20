import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { query } from '@warp-drive/legacy/compat/builders';

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
   * The change-event requests about the organisation that still wait for
   * ABB: shown with the events, as the designs ask. An empty list when the
   * service does not answer: the events are shown all the same.
   */
  async loadPendingRequests(organizationId) {
    try {
      const { requests } = await this.changeRequests.list({
        target: organizationId,
        kind: 'change-event',
        status: 'ingediend,informatie-gevraagd',
        size: 100,
      });
      return requests;
    } catch (error) {
      console.warn(
        'The pending change-event requests could not be loaded:',
        error,
      );
      return [];
    }
  }
}
