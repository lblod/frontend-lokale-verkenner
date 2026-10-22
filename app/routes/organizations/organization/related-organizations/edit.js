import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { query as queryBuilder } from '@warp-drive/legacy/compat/builders';
import getFiltersForRoleLabel from 'frontend-organization-portal/utils/get-filters-for-role-label';

export default class OrganizationsOrganizationRelatedOrganizationsEditRoute extends Route {
  @service router;
  @service store;

  queryParams = {
    sort: { refreshModel: true },
    page: { refreshModel: true },
    selectedRoleLabel: { refreshModel: true, replace: true },
  };

  beforeModel() {
    // Not switched to change requests: the saves of this page go straight to
    // the resource routes, which the backend refuses. Nothing links to it
    // until it is switched; it never opens.
    this.router.transitionTo('unauthorized');
  }

  async model(params) {
    const { organization, roles, selectableRoles } = this.modelFor(
      'organizations.organization.related-organizations',
    );

    let query = {
      include: 'role,member,organization',
      // sort: params.sort,
      page: { size: params.size, number: params.page },
    };

    const filters = getFiltersForRoleLabel({
      roles,
      organization,
      roleLabel: params.selectedRoleLabel,
    });

    filters.forEach((value, key) => (query[key] = value));

    const { content: memberships } = await this.store.request(
      queryBuilder('membership', query),
    );

    return {
      organization,
      memberships,
      roles,
      selectableRoles,
    };
  }

  setupController(controller, model) {
    super.setupController(...arguments);
    controller.setup(model);
  }

  resetController(controller) {
    super.resetController(...arguments);
    controller.reset();
  }
}
