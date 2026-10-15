import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import {
  createPrimaryContact,
  createSecondaryContact,
  findPrimaryContact,
  findSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';
import isContactEditableOrganization from 'frontend-organization-portal/utils/editable-contact-data';

export default class OrganizationsOrganizationSitesSiteEditRoute extends Route {
  @service store;
  @service changeRequests;
  @service router;
  @service features;

  beforeModel() {
    // The organisation of the transition, which may differ from the one on
    // screen when the page is opened from elsewhere.
    const { id } = this.paramsFor('organizations.organization');
    if (!this.changeRequests.canEditOrganization(id)) {
      this.router.transitionTo('unauthorized');
    }
  }

  afterModel(model) {
    if (!(
      this.features.isEnabled('edit-contact-data') ||
      isContactEditableOrganization(model.organization)
    )) {
      this.router.transitionTo('unauthorized');
    }
  }

  async model() {
    let { site } = this.modelFor('organizations.organization.sites.site');

    // The organisation's sites as they are now: the page changes which site
    // is primary, and its change request starts from these values (its
    // base), also when a held save refreshes the page.
    let { id: organizationId } = this.modelFor('organizations.organization');
    let { content: organization } = await this.store.request(
      findRecord('organization', organizationId, {
        reload: true,
        include: 'primary-site,sites',
      }),
    );

    let contacts = await site.contacts;

    let contact = findPrimaryContact(contacts);
    if (!contact) {
      contact = createPrimaryContact(this.store);
    }

    let secondaryContact = findSecondaryContact(contacts);
    if (!secondaryContact) {
      secondaryContact = createSecondaryContact(this.store);
    }

    let address = await site.address;

    return {
      site,
      address,
      contact,
      secondaryContact,
      organization,
      currentPrimarySite: await organization.primarySite,
    };
  }

  setupController(controller) {
    super.setupController(...arguments);
    controller.setup();
  }

  resetController(controller) {
    super.resetController(...arguments);
    controller.reset();
  }
}
