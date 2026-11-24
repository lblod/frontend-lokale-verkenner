import Controller from '@ember/controller';
import { dropTask } from 'ember-concurrency';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { recordIdentifierFor } from '@warp-drive/core';
import { query as queryBuilder } from '@warp-drive/legacy/compat/builders';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import {
  MEMBERSHIP_LABELS,
  PERIOD_LABELS,
  heldRequestNotice,
  reportHeldRequest,
} from 'frontend-organization-portal/utils/change-request-conflicts';
import {
  removingMembershipBreaksMinimum,
  shouldSwapAssignments,
} from 'frontend-organization-portal/utils/membership-rules';
import { isEmptyPeriod } from 'frontend-organization-portal/utils/period-of-time';

export default class OrganizationsOrganizationRelatedOrganizationsEditController extends Controller {
  @service router;
  @service store;
  @service changeRequests;
  @service toaster;

  queryParams = ['page', 'size', 'selectedRoleLabel'];

  @tracked page = 0;
  @tracked size = 500;

  @tracked memberships;
  @tracked selectedRoleLabel;

  @tracked founderToRemove;

  @tracked membershipRemovalError;

  @tracked nonActiveMembership;
  @tracked nonActiveRelatedOrganization;

  @tracked saveError;
  // Blocked after an unknown outcome, a failed apply, or a failed reload.
  @tracked saveBlocked = false;
  // The held request and its conflicting fields, for the notice.
  @tracked heldRequest = null;
  // The kept request to link to after a failed apply.
  @tracked failedRequestId = null;
  // Changes after a held save so the table rebuilds from the reloaded rows.
  @tracked formRevision = 0;

  get hasValidationErrors() {
    // Removed rows are hidden, so their errors can never be shown; they are
    // deleted regardless of their fields and must not block the save.
    return this.memberships.some(
      (membership) =>
        !membership.isDeleted && (membership.error || membership.during?.error),
    );
  }

  get hasUnsavedEdits() {
    return this.memberships.some((membership) => {
      const period = membership.during;
      return (
        membership.isNew ||
        membership.isDeleted ||
        period?.isNew ||
        period?.hasDirtyAttributes
      );
    });
  }

  setup() {
    if (!this.memberships) {
      this.memberships = this.model.memberships;
    }
    if (this.memberships.length === 0) {
      this.addMembership();
    }
  }

  @action
  addMembership() {
    let membership = this.store.createRecord('membership');
    this.memberships = [...this.memberships, membership];
  }

  // A drop task, so a second click supersedes a removal that is still
  // fetching the other organization's memberships instead of letting both
  // open their confirmation.
  removeMembership = dropTask(async (membership) => {
    // A row that was added in this editing session was never stored, so
    // removing it cannot take an organization below a minimum and doesn't need confirmation.
    if (membership.isNew) {
      this.reallyRemoveMembership(membership);
      return;
    }

    // The organization being edited must keep meeting the minimum of the
    // field the membership belongs to.
    if (
      removingMembershipBreaksMinimum(
        membership,
        this.model.organization,
        this.memberships ?? [],
      )
    ) {
      this.membershipRemovalError = this.#removalErrorFor('je organisatie');
      return;
    }

    // The organization on the other side of the membership must keep meeting
    // its minimums as well. Its memberships are not on this page, so they are
    // fetched here.
    const otherOrganization = this.#otherOrganizationOf(membership);
    if (otherOrganization) {
      const memberships = this.memberships;
      const otherMemberships =
        await this.#fetchMembershipsOf(otherOrganization);
      // The page was left or re-entered while fetching: opening the
      // confirmation now would attach it to whatever is shown next.
      if (this.memberships !== memberships) return;
      if (
        otherMemberships &&
        removingMembershipBreaksMinimum(
          membership,
          otherOrganization,
          otherMemberships,
        )
      ) {
        this.membershipRemovalError = this.#removalErrorFor(
          otherOrganization.abbName,
        );
        return;
      }
    }

    this.founderToRemove = membership;
  });

  @action
  cancelMembershipRemoval() {
    this.founderToRemove = undefined;
  }

  @action
  dismissMembershipRemovalError() {
    this.membershipRemovalError = null;
  }

  /**
   * The organization on the other side of the given membership. `null` for a
   * row that was added but never filled in completely.
   */
  #otherOrganizationOf(membership) {
    const organization = this.model.organization;
    return membership.belongsTo('member').value() === organization
      ? membership.belongsTo('organization').value()
      : membership.belongsTo('member').value();
  }

  /**
   * The persisted memberships of the given organization, on both the
   * `organization` and the `member` side. `null` if they could not be loaded:
   * the page size matches the one this page loads for the organization being
   * edited.
   */
  async #fetchMembershipsOf(organization) {
    try {
      const { content } = await this.store.request(
        queryBuilder('membership', {
          'filter[:or:][member][:id:]': organization.id,
          'filter[:or:][organization][:id:]': organization.id,
          include:
            'role,member,organization,member.classification,organization.classification',
          page: { size: 500, number: 0 },
        }),
      );
      return content;
    } catch {
      // Without the memberships the minimum of the other organization cannot
      // be checked. Allow the removal in that case, as it was before the
      // other side of a removal was checked at all.
      return null;
    }
  }

  #removalErrorFor(organizationName) {
    return `Je kan deze relatie niet verwijderen omdat ${organizationName} anders onder het vereiste minimum aantal relaties van dit type komt.`;
  }

  @action
  reallyRemoveMembership(membership) {
    // NOTE (28/02/2025): If `this.founderToRemove` is set the call comes via
    // the confirmation modal, in that case ignore any value provided for
    // `membership`.
    if (this.founderToRemove) {
      membership = this.founderToRemove;
    }
    // NOTE The `save` function below depends on the contents of the
    // memberships array to persist the necessary changes:
    // - do *not* remove any already persisted memberships from the array as
    //   this will cause their deletion to "forgotten" in the `save` function.
    // - do remove newly added memberships that have not been persisted yet.
    //   Otherwise, they can result in failing validations or errors.
    if (membership.isNew) {
      this.memberships = this.memberships.filter((m) => m !== membership);
      this.#rollbackPeriod(membership);
      membership.deleteRecord();
      membership.unloadRecord();
    } else {
      membership.deleteRecord();
    }
    this.founderToRemove = undefined;
  }

  @action
  setRelatedOrganizationMembership(membership, organization) {
    if (organization.isActive) {
      this.#setOtherMembershipResource(membership, organization);
    } else {
      this.nonActiveMembership = membership;
      this.nonActiveRelatedOrganization = organization;
    }
  }

  @action
  confirmNonActiveRelatedOrganization() {
    this.#setOtherMembershipResource(
      this.nonActiveMembership,
      this.nonActiveRelatedOrganization,
    );
    this.nonActiveMembership = undefined;
    this.nonActiveRelatedOrganization = undefined;
  }

  @action
  cancelNonActiveRelatedOrganization() {
    this.#setOtherMembershipResource(this.nonActiveMembership, undefined);
    this.nonActiveMembership = undefined;
    this.nonActiveRelatedOrganization = undefined;
  }

  #setOtherMembershipResource(membership, organization) {
    if (membership.member.id === this.model.organization.id) {
      membership.organization = organization;
    } else {
      membership.member = organization;
    }
  }

  @action
  setStartDate(membership, date) {
    this.#setPeriodDate(membership, 'startDate', date);
  }

  @action
  setEndDate(membership, date) {
    this.#setPeriodDate(membership, 'endDate', date);
  }

  // Creates the period on the first date; clearing a date of a membership
  // without period changes nothing
  #setPeriodDate(membership, field, date) {
    let period = membership.during;
    if (!period) {
      if (!date) {
        return;
      }
      period = this.store.createRecord('period-of-time');
      membership.during = period;
    }
    period[field] = date;
  }

  // A row that was added but never filled in
  #isEmptyMembership(membership) {
    const org = membership.belongsTo('organization').value();
    const member = membership.belongsTo('member').value();
    const role = membership.belongsTo('role').value();

    return !org && !member && !role && isEmptyPeriod(membership.during);
  }

  @action
  updateMembershipRole(membership, roleLabel) {
    // Remove any previous assignments
    membership.member = null;
    membership.organization = null;

    // Find the role model matching the label
    // Note: this assumes that each different membership role has unique labels
    const roleModel = this.model.roles.find(
      (r) => r.opLabel === roleLabel || r.inverseOpLabel === roleLabel,
    );
    membership.role = roleModel;

    // Determine the correct assignment for the current organization based on
    // "direction" of the label.  This implies that the user decides who
    // becomes the `member` and `organization` by selecting the right label.
    // Note, for memberships with the "has a relation with" role, the 'right'
    // assignment depends on the classification of the other involved
    // organization and it will be corrected, if necessary, upon saving the
    // membership.
    if (roleLabel === roleModel.opLabel) {
      membership.member = this.model.organization;
    } else if (roleLabel === roleModel.inverseOpLabel) {
      membership.organization = this.model.organization;
    }
  }

  @action
  displayRoleLabel(membership) {
    return membership.getRoleLabelForPerspective(this.model.organization);
  }

  save = dropTask(async (event) => {
    event.preventDefault();
    if (this.saveBlocked) {
      return;
    }
    this.saveError = null;
    this.heldRequest = null;

    this.memberships = this.memberships.filter((membership) => {
      if (membership.isNew && this.#isEmptyMembership(membership)) {
        this.#rollbackPeriod(membership);
        membership.deleteRecord();
        membership.unloadRecord();
        return false;
      }
      return true;
    });

    let organization = this.model.organization;
    await organization.validate();

    let validationPromises = this.memberships.map(async (membership) => {
      const period = membership.during;
      if (membership.isDeleted) {
        // A removed row is deleted together with its period, so neither needs
        // validating; clear the errors left by an earlier save attempt.
        membership.resetErrors();
        period?.resetErrors();
        return;
      }
      await membership.validate();
      await period?.validate();
    });
    await Promise.all(validationPromises);

    if (!this.hasValidationErrors) {
      // Filter duplicate memberships, this means memberships that have the same
      // member, organization, and role.
      // Note: Do *not* move this filtering earlier in the function, that
      // results in nasty interactions/errors when a validation fails.
      this.memberships = this.memberships.filter(
        (membership, index, memberships) =>
          index === memberships.findIndex((m) => membership.equals(m)),
      );

      // For "has relation with" memberships, assign the current organization
      // according to the configuration of allowed relations. For the user a "has
      // a relation with" has no direction, but we do enforce one to ensure
      // consistent data.
      // Notes:
      // - The form ensures that the user cannot select organizations kinds
      //   that would result in a disallowed relation. So at this point each
      //   membership should have valid involved organizations, except that the
      //   `member` and `organization` may need to be swapped.
      // - Currently the membership validations only check whether required
      //   values are present, not whether the memberships are correct allowed,
      //   see notes in `membership.validationSchema`. If this changes any swap
      //   should be performed validation.
      this.memberships = await Promise.all(
        this.memberships.map(async (membership) => {
          if (
            membership.isHasRelationWithMembership &&
            shouldSwapAssignments(membership) &&
            membership.isNew
          ) {
            [membership.member, membership.organization] = [
              await membership.organization,
              await membership.member,
            ];
          }
          return membership;
        }),
      );

      // An empty period the user added is not saved.
      for (const membership of this.memberships) {
        const period = membership.during;
        if (!membership.isDeleted && period?.isNew && isEmptyPeriod(period)) {
          membership.during = null;
          period.rollbackAttributes();
        }
      }

      const records = this.#records();

      try {
        // No changes: leave without a request.
        if (!this.changeRequests.hasChanges(records)) {
          this.router.transitionTo(
            'organizations.organization.related-organizations',
            organization.id,
          );
          return;
        }
        await this.changeRequests.submit(
          'related-organizations',
          organization.id,
          records,
        );
      } catch (error) {
        if (!(error instanceof ChangeRequestError)) {
          throw error;
        }
        if (error.applied) {
          // Applied, but the page could not reload: let the overview show it.
          this.toaster.warning(error.message, 'Wijziging doorgevoerd');
          this.router.refresh();
          this.router.transitionTo(
            'organizations.organization.related-organizations',
            organization.id,
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
        'organizations.organization.related-organizations',
        organization.id,
      );
    }
  });

  // Dependencies first: periods before their memberships, a deleted
  // membership before its period. The organisation is not part of the request.
  #records() {
    const deleted = [];
    const periods = [];
    const memberships = [];

    for (const membership of this.memberships) {
      const period = membership.during;
      if (membership.isDeleted) {
        deleted.push(membership);
        if (period && !period.isNew) {
          deleted.push(period);
        } else if (period?.isNew) {
          // Never saved: nothing to delete, and the deleted row must not carry it.
          membership.during = null;
          period.rollbackAttributes();
        }
        continue;
      }
      if (period?.isNew || period?.hasDirtyAttributes) {
        periods.push(period);
      }
      if (
        membership.isNew ||
        membership.hasDirtyAttributes ||
        // A relinked period is not a dirty attribute, so check it separately.
        this.#relinked(membership, period)
      ) {
        memberships.push(membership);
      }
    }

    const records = [...deleted, ...periods, ...memberships];
    return records;
  }

  // Whether the membership links another period than the backend has.
  #relinked(membership, period) {
    // A new period has no id, so linking it always changes the membership.
    if (period?.isNew) {
      return true;
    }
    const stored =
      this.store.cache.getRemoteRelationship(
        recordIdentifierFor(membership),
        'during',
      )?.data?.id ?? null;
    return (period?.id ?? null) !== stored;
  }

  // The records and the labels their fields have in the notice.
  fieldLabels() {
    const labels = [];
    for (const membership of this.memberships ?? []) {
      if (membership.isDestroyed || membership.isDestroying) {
        continue;
      }
      labels.push([membership, MEMBERSHIP_LABELS]);
      const period = membership.during;
      if (period) {
        labels.push([period, PERIOD_LABELS]);
      }
    }
    return labels;
  }

  // Reload the route, then show the notice; the refresh resets this controller.
  async showHeldRequest(heldRequest) {
    try {
      await this.router.refresh(
        'organizations.organization.related-organizations',
      );
    } catch (error) {
      reportHeldRequest(this.toaster, error, heldRequest.waiting);
      return;
    }
    this.formRevision += 1;
    this.heldRequest = heldRequest;
    this.saveBlocked = heldRequest.reloadFailed;
  }

  reset() {
    this.#rollbackPeriods();
    this.#rollbackMemberships();
    this.model.organization.reset();
    this.memberships = null;
    this.selectedRoleLabel = null;
    this.founderToRemove = null;
    this.membershipRemovalError = null;
    this.nonActiveMembership = null;
    this.nonActiveRelatedOrganization = null;
    this.saveError = null;
    this.saveBlocked = false;
    this.heldRequest = null;
    this.failedRequestId = null;
  }

  /**
   * Undo the unsaved changes: restore the persisted memberships that were
   * removed and unload the ones that were added. Memberships whose save is
   * still in flight are left alone (this also runs on every exit of the
   * route, including after a save).
   */
  #rollbackMemberships() {
    const memberships = this.memberships?.slice() ?? [];
    memberships.forEach((membership) => {
      if (
        membership.isDestroyed ||
        membership.isDestroying ||
        membership.isSaving
      ) {
        return;
      }
      // `hasDirtyAttributes` is also true for an uncommitted deletion
      if (membership.isNew || membership.hasDirtyAttributes) {
        membership.reset();
      } else {
        // Clear the errors of a failed save
        membership.resetErrors();
      }
    });
  }

  /**
   * Undo the unsaved changes to the periods, before the memberships are rolled
   * back (the period of an unloaded membership is no longer reachable).
   */
  #rollbackPeriods() {
    const memberships = this.memberships?.slice() ?? [];
    memberships.forEach((membership) => {
      if (membership.isDestroyed || membership.isDestroying) {
        return;
      }
      this.#rollbackPeriod(membership);
    });
  }

  #rollbackPeriod(membership) {
    const period = membership.during;
    if (!period || period.isDestroyed || period.isDestroying) {
      return;
    }
    if (membership.isSaving || period.isSaving) {
      return;
    }
    if (period.isNew) {
      if (!membership.isNew) {
        // Unlink the never saved period from the persisted membership
        this.store.cache.rollbackRelationships(recordIdentifierFor(membership));
      }
      period.reset();
    } else if (period.hasDirtyAttributes) {
      period.reset();
    } else {
      // Clear the errors of a failed save
      period.resetErrors();
    }
  }
}
