import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class OrganizationsOrganizationChangeEventsNewRoute extends Route {
  @service router;
  @service store;

  beforeModel() {
    // Not switched to change requests: the saves of this page go straight to
    // the resource routes, which the backend refuses. Nothing links to it
    // until it is switched; it never opens.
    this.router.transitionTo('unauthorized');
  }

  async model() {
    let organization = this.modelFor('organizations.organization');
    let changeEvent = this.store.createRecord('change-event', {
      originalOrganizations: [organization],
    });
    let decision = this.store.createRecord('decision');
    let decisionActivity = this.store.createRecord('decision-activity');

    return {
      organization,
      changeEvent,
      decision,
      decisionActivity,
    };
  }

  resetController(controller) {
    super.resetController(...arguments);

    controller.reset();
  }
}
