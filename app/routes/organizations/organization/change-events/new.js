import Route from '@ember/routing/route';
import { service } from '@ember/service';

/**
 * The form that requests a veranderingsgebeurtenis about the organisation
 * on screen. It opens for who may edit the organisation (the change-request
 * service's permissions, loaded by the organisation route); the request
 * waits for ABB unless ABB submits it.
 */
export default class OrganizationsOrganizationChangeEventsNewRoute extends Route {
  @service router;
  @service store;
  @service changeRequests;

  beforeModel() {
    const { id } = this.paramsFor('organizations.organization');
    if (!this.changeRequests.canEditOrganization(id)) {
      this.router.transitionTo('unauthorized');
    }
  }

  async model() {
    const organization = this.modelFor('organizations.organization');

    // The fields an event may change, loaded before the form changes them:
    // the request carries their loaded values as its base, and the
    // organisation route loads the status only (the others come as links,
    // which the store reads as empty). The qualifications are a
    // synchronous relationship, which is only loaded on a reload.
    await Promise.all([
      organization.organizationStatus,
      organization.legalForm,
      // Administrative units and registered organisations have one
      organization.scope,
      organization.hasMany('additionalQualifications').reload(),
    ]);

    const changeEvent = this.store.createRecord('change-event', {
      originalOrganizations: [organization],
    });
    const decision = this.store.createRecord('decision');

    return {
      organization,
      changeEvent,
      decision,
    };
  }

  resetController(controller) {
    super.resetController(...arguments);

    controller.reset();
  }
}
