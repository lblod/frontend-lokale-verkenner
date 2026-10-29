import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import {
  createPrimaryContact,
  createSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';

/**
 * The form that requests a new organisation. It opens for who may request
 * one: ABB, or an organisation that manages others according to the
 * change-request service ("Wie beheert"). The request carries the
 * organisation with its identifiers and primary site, and its oprichting as
 * a change event with the link to the besluit; ABB's request is applied at
 * once, anyone else's waits for ABB.
 */
export default class OrganizationsNewRoute extends Route {
  @service store;
  @service router;
  @service changeRequests;

  async beforeModel() {
    const rights = await this.changeRequests.loadRights();
    if (!rights.canDecide && rights.canCreate.length === 0) {
      this.router.transitionTo('unauthorized');
    }
  }

  async model() {
    const structuredIdentifierKBO = this.store.createRecord(
      'structured-identifier',
    );
    const identifierKBO = this.store.createRecord('identifier', {
      idName: ID_NAME.KBO,
      structuredIdentifier: structuredIdentifierKBO,
    });
    const structuredIdentifierSharepoint = this.store.createRecord(
      'structured-identifier',
    );
    const identifierSharepoint = this.store.createRecord('identifier', {
      idName: ID_NAME.SHAREPOINT,
      structuredIdentifier: structuredIdentifierSharepoint,
    });

    // The oprichting of the organisation, as every organisation has one
    let oprichting;
    try {
      ({ content: oprichting } = await this.store.request(
        findRecord('change-event-type', CHANGE_EVENT_TYPE.OPRICHTING),
      ));
    } catch (error) {
      throw new Error(
        'De code lijst van de veranderingsgebeurtenissen ontbreekt (type "Oprichting"), waardoor geen organisatie aangevraagd kan worden.',
        { cause: error },
      );
    }
    const decision = this.store.createRecord('decision');
    const changeEvent = this.store.createRecord('change-event', {
      type: oprichting,
      description: 'Oprichting',
      decision,
    });

    return {
      primarySite: this.store.createRecord('site'),
      address: this.store.createRecord('address', {
        country: 'België',
      }),
      contact: createPrimaryContact(this.store),
      secondaryContact: createSecondaryContact(this.store),
      identifierKBO,
      structuredIdentifierKBO,
      identifierSharepoint,
      structuredIdentifierSharepoint,
      changeEvent,
      decision,
    };
  }

  resetController(controller) {
    super.resetController(...arguments);
    controller.reset();
  }

  setupController(controller) {
    super.setupController(...arguments);

    controller.set(
      'currentOrganizationModel',
      this.store.createRecord('organization'),
    );
  }
}
