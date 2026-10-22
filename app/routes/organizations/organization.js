import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';

export default class OrganizationsOrganizationRoute extends Route {
  @service store;
  @service changeRequests;

  async model(params) {
    // Note: Already include status, otherwise the validations can fail when the
    // user tries to save edits without that they previously visited the core
    // data page.
    // We also pre-load the classification because the "isX" getters are used in routes that don't display the classification.
    const { content: organization } = await this.store.request(
      findRecord('organization', params.id, {
        include: 'organization-status,classification',
      }),
    );

    // Whether the session may edit this organisation decides which edit
    // actions the pages show and whether the edit routes open (their
    // `beforeModel` guards ask `changeRequests.canEditOrganization` for the
    // id of the transition), so it must be known before any child route runs.
    await this.changeRequests.loadPermissions(organization.id);

    return organization;
  }

  setupController(controller, organization) {
    super.setupController(...arguments);

    // Only once the transition is committed is this the organisation on
    // screen: a transition that was abandoned for another one never gets
    // here, so its permissions never show on the pages of another
    // organisation. Runs again when the organisation changes.
    this.changeRequests.enterOrganization(organization.id);
  }

  deactivate() {
    super.deactivate(...arguments);
    // Outside the organisation pages nothing is editable
    this.changeRequests.leaveOrganization();
  }
}
