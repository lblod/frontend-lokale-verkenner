import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';

export default class OrganizationsOrganizationChangeEventsDetailsEditRoute extends Route {
  @service router;
  @service store;

  beforeModel() {
    // Not switched to change requests: the saves of this page go straight to
    // the resource routes, which the backend refuses. Nothing links to it
    // until it is switched; it never opens.
    this.router.transitionTo('unauthorized');
  }

  async model() {
    let { changeEvent, organization, ...detailsPageModel } = this.modelFor(
      'organizations.organization.change-events.details',
    );

    let canAddDecisionInformation =
      changeEvent.type.id !== CHANGE_EVENT_TYPE.RECOGNITION_REQUESTED;

    let model = {
      organization,
      ...detailsPageModel,
      changeEvent,
    };

    if (canAddDecisionInformation) {
      let decision = await changeEvent.decision;
      let decisionActivity = null;
      if (decision) {
        decisionActivity = await decision.hasDecisionActivity;
      }

      if (!decision) {
        decision = this.store.createRecord('decision');
      }

      if (!decisionActivity) {
        decisionActivity = this.store.createRecord('decision-activity');
      }

      if (decision.documentLinks.length === 0) {
        // We assign a new array instead of pushing in an empty link, so that WarpDrive notices the change and it can be rolled back with `rollbackAttributes()`
        decision.documentLinks = [''];
      }

      model.decision = decision;
      model.decisionActivity = decisionActivity;
    }

    return model;
  }

  resetController(controller) {
    super.resetController(...arguments);
    controller.reset();
  }
}
