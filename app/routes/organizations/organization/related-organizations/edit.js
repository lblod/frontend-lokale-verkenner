import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { query as queryBuilder } from '@warp-drive/legacy/compat/builders';
import getFiltersForRoleLabel from 'frontend-organization-portal/utils/get-filters-for-role-label';

export default class OrganizationsOrganizationRelatedOrganizationsEditRoute extends Route {
  @service router;
  @service store;

  queryParams = {
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
    const {
      organization,
      roles,
      selectableRoles,
      selectableRoleLabels,
      allowedRoleLabels,
    } = this.modelFor('organizations.organization.related-organizations');

    let query = {
      // The classifications are needed for the minimum check on removal: a
      // minimum restricted to certain types must not count an organization
      // whose classification is not loaded.
      include: [
        'role',
        'member.classification',
        'member.organization-status',
        'organization.classification',
        'organization.organization-status',
        'during',
      ].join(),
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

    // We sort manually instead of via the query's sort argument because it
    // depends on the direction of the membership whether to use the member
    // or organization value for sorting.
    const otherOrganizationOf = (membership) =>
      membership.belongsTo('member').value() === organization
        ? membership.belongsTo('organization').value()
        : membership.belongsTo('member').value();

    const sortedMemberships = memberships
      .slice()
      .sort((a, b) =>
        otherOrganizationOf(a).abbName.localeCompare(
          otherOrganizationOf(b).abbName,
        ),
      );

    return {
      organization,
      memberships: sortedMemberships,
      roles,
      selectableRoles,
      selectableRoleLabels,
      allowedRoleLabels,
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
