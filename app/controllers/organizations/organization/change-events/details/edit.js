import Controller from '@ember/controller';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { isNameChangeType } from 'frontend-organization-portal/models/change-event-type';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import {
  CHANGE_EVENT_LABELS,
  CHANGE_EVENT_RESULT_LABELS,
  DECISION_ACTIVITY_LABELS,
  DECISION_LABELS,
  ORGANIZATION_CORE_DATA_LABELS,
  heldRequestNotice,
  reportHeldRequest,
} from 'frontend-organization-portal/utils/change-request-conflicts';
import isMostRecentChangeEvent from 'frontend-organization-portal/utils/is-most-recent-change-event';
import { isLoaded } from 'frontend-organization-portal/utils/records';

export default class OrganizationsOrganizationChangeEventsDetailsEditController extends Controller {
  @service router;
  @service store;
  @service changeRequests;
  @service toaster;

  isNameChangeType = isNameChangeType;

  @tracked saveError;
  // Blocked after an unknown outcome, a failed apply, or a failed reload.
  @tracked saveBlocked = false;
  // The held request and its conflicting fields, for the notice.
  @tracked heldRequest = null;
  // The kept request to link to after a failed apply.
  @tracked failedRequestId = null;
  // Changes after a held save so the form rebuilds from the reloaded records.
  @tracked formRevision = 0;

  get hasValidationErrors() {
    return this.model.changeEvent.error || this.model.decision?.error;
  }

  save = dropTask(async (event) => {
    event.preventDefault();
    if (this.saveBlocked) {
      return;
    }
    this.saveError = null;
    this.heldRequest = null;

    let {
      organization,
      changeEvent,
      currentChangeEventResult,
      decision,
      decisionActivity,
    } = this.model;

    if (changeEvent.requiresDecisionInformation) {
      decision.documentLinks = decision.documentLinks.filter((link) =>
        link.trim(),
      );
    }

    await changeEvent.validate();

    if (changeEvent.requiresDecisionInformation) {
      await decision.validate();
    }

    if (
      isNameChangeType(changeEvent.type) &&
      !currentChangeEventResult.resultingName
    ) {
      changeEvent.addError('resultingName', 'Vul de nieuwe naam in');
    }

    // The change event can only be saved when the new name differs from the
    // name this change event was created to change. Old change events don't
    // have the original name persisted and can simply be edited as before
    if (
      isNameChangeType(changeEvent.type) &&
      currentChangeEventResult.originalName
    ) {
      if (
        currentChangeEventResult.resultingName?.trim() ===
        currentChangeEventResult.originalName?.trim()
      ) {
        changeEvent.addError(
          'resultingName',
          'De huidige en nieuwe waarde kunnen niet hetzelfde zijn.',
        );
      }
    }

    if (this.hasValidationErrors) {
      return;
    }

    // The records in creation order: besluit, activity, event, result,
    // organisation.
    const records = [];

    const withDecision =
      changeEvent.requiresDecisionInformation && !decision.isEmpty;
    if (changeEvent.requiresDecisionInformation) {
      // Clearing the link removes the besluit; a persisted besluit is deleted.
      changeEvent.decision = withDecision ? decision : null;
      if (withDecision) {
        records.push(decision);
      } else if (!decision.isNew) {
        decision.deleteRecord();
        records.push(decision);
      }
    }

    // A new activity links the besluit from its own side.
    if (withDecision && decisionActivity.changedAttributes().endDate) {
      if (decisionActivity.isNew) {
        decisionActivity.givesCauseTo = [decision];
      }
      records.push(decisionActivity);
    }

    records.push(changeEvent);

    // Only the resulting name is editable on the result.
    if (currentChangeEventResult.changedAttributes().resultingName) {
      records.push(currentChangeEventResult);
    }

    // The corrected name follows to the organisation unless a later event exists.
    if (
      isNameChangeType(changeEvent.type) &&
      currentChangeEventResult.resultingName &&
      (await isMostRecentChangeEvent(this.store, changeEvent, organization))
    ) {
      organization.setAbbName(currentChangeEventResult.resultingName);
    }
    if (organization.hasDirtyAttributes) {
      records.push(organization);
    }

    try {
      // No changes: leave without a request.
      if (!this.changeRequests.hasChanges(records)) {
        this.router.transitionTo(
          'organizations.organization.change-events.details',
          changeEvent.id,
        );
        return;
      }
      await this.changeRequests.submit(
        'change-event-edit',
        organization.id,
        records,
      );
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      if (error.applied) {
        // Applied, but the page could not reload: let the details page show it.
        this.toaster.warning(error.message, 'Wijziging doorgevoerd');
        this.router.refresh();
        this.router.transitionTo(
          'organizations.organization.change-events.details',
          changeEvent.id,
        );
        return;
      }
      if (error.held) {
        // Nothing applied; the records are back at the backend's state.
        await this.showHeldRequest(
          heldRequestNotice(error, this.fieldLabels()),
        );
        return;
      }
      // Keep the edits for a retry, unless the outcome is unknown or the
      // apply failed.
      this.saveError = error.message;
      this.saveBlocked = error.outcomeUnknown || error.applyFailed;
      this.failedRequestId = error.applyFailed ? error.requestId : null;
      return;
    }

    this.router.transitionTo(
      'organizations.organization.change-events.details',
      changeEvent.id,
    );
  });

  // Reload the route, then show the notice; the refresh resets this controller.
  async showHeldRequest(heldRequest) {
    try {
      await this.router.refresh(
        'organizations.organization.change-events.details',
      );
    } catch (error) {
      reportHeldRequest(this.toaster, error, heldRequest.waiting);
      return;
    }
    this.formRevision += 1;
    this.heldRequest = heldRequest;
    this.saveBlocked = heldRequest.reloadFailed;
  }

  // The records and the labels their fields have in the notice.
  fieldLabels() {
    const {
      organization,
      changeEvent,
      currentChangeEventResult,
      decision,
      decisionActivity,
    } = this.model;
    return [
      [changeEvent, CHANGE_EVENT_LABELS],
      [currentChangeEventResult, CHANGE_EVENT_RESULT_LABELS],
      [decision, DECISION_LABELS],
      [decisionActivity, DECISION_ACTIVITY_LABELS],
      [organization, ORGANIZATION_CORE_DATA_LABELS],
    ];
  }

  reset() {
    const {
      organization,
      changeEvent,
      decision,
      decisionActivity,
      currentChangeEventResult,
    } = this.model;

    // Relationships are not covered by rollbackAttributes.
    if (isLoaded(decisionActivity)) {
      this.changeRequests.rollbackRelationships(decisionActivity);
      decisionActivity.rollbackAttributes();
    }

    for (const record of [organization, changeEvent, decision]) {
      if (isLoaded(record)) {
        record.reset();
      }
    }
    if (isLoaded(currentChangeEventResult)) {
      currentChangeEventResult.rollbackAttributes();
    }

    this.saveError = null;
    this.saveBlocked = false;
    this.heldRequest = null;
    this.failedRequestId = null;
  }
}
