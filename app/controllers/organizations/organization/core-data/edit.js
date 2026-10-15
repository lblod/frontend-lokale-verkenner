import Controller from '@ember/controller';
import { dropTask } from 'ember-concurrency';
import { service } from '@ember/service';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { action } from '@ember/object';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import isContactEditableOrganization from 'frontend-organization-portal/utils/editable-contact-data';
import { tracked } from '@glimmer/tracking';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { ScopeOfOperationError } from 'frontend-organization-portal/services/scope-of-operation';
import {
  hasUserInput,
  isLoaded,
} from 'frontend-organization-portal/utils/records';
import {
  ADDRESS_LABELS,
  ORGANIZATION_CORE_DATA_LABELS,
  PRIMARY_CONTACT_LABELS,
  PRIMARY_SITE_LABELS,
  SECONDARY_CONTACT_LABELS,
  heldRequestNotice,
  reportHeldRequest,
} from 'frontend-organization-portal/utils/change-request-conflicts';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';
import requiresKbo from '../../../../helpers/requires-kbo';

export default class OrganizationsOrganizationCoreDataEditController extends Controller {
  @service router;
  @service store;
  @service features;
  @service scopeOfOperation;
  @service changeRequests;
  @service toaster;

  /**
   * The locations of the organisation's werkingsgebied as the route loaded
   * them and the user edited them. Null when they could not be loaded: the
   * werkingsgebied is then left as it is on save, see `scopeNotLoaded`.
   */
  @tracked locationsInScope;
  /**
   * The message of the change-request service when it refused the last save.
   */
  @tracked saveError;
  /**
   * Whether saving is blocked until the page is reloaded: the last save
   * ended without knowing whether the change was applied (a 5xx), and a
   * retry could apply it twice; its apply failed (see `failedRequestId`); or
   * it was held and the records could not be reloaded, so a new save would
   * start from values that are not the current ones.
   */
  @tracked saveBlocked = false;
  /**
   * Set when the change-request service held the last save instead of
   * applying it, because someone else changed the same data in the
   * meantime: `{ id, fields, reloadFailed }`, the request and the labels of
   * those fields (see `heldRequestNotice`). The form then shows the current
   * values again; the request waits for a decision by ABB.
   */
  @tracked heldRequest = null;
  /**
   * The uuid of the request whose apply failed on the last save (a 409 with
   * status mislukt). The service kept it, and the apply may have stopped
   * half-way, leaving the fields it changes empty; a new save would start
   * from the values the page loaded and conflict with that. Saving is
   * blocked, `reapply` applies the kept request again.
   */
  @tracked failedRequestId = null;
  /**
   * Bumped once the records are reloaded after a held save, so that the
   * template builds the form anew (`<Rebuild>`): some of its components (the
   * address search, the rich-text editor, the qualifications choice) keep
   * the values they were created with.
   */
  @tracked formRevision = 0;

  get hasValidationErrors() {
    return (
      this.model.organization.error ||
      this.model.address.error ||
      this.model.contact.error ||
      this.model.secondaryContact.error ||
      (requiresKbo(this.model.organization) &&
        this.model.identifierKBO?.error) ||
      this.model.identifierSharepoint.error
    );
  }

  /**
   * Whether the locations of the werkingsgebied could not be loaded, in
   * which case the field is shown disabled and the werkingsgebied is kept.
   */
  get scopeNotLoaded() {
    return this.locationsInScope === null;
  }

  get vendorsString() {
    const vendors = this.model.organization.hasMany('vendors').value();
    if (!vendors || !vendors.length) {
      return 'Loket voor Lokale Besturen';
    }
    return vendors.map((item) => item.name).join(', ');
  }

  @action
  setNames(name) {
    this.model.organization.setAbbName(name);
  }

  @action
  setAlternativeNames(names) {
    this.model.organization.setAlternativeName(names);
  }

  @action
  setKbo(event) {
    this.model.structuredIdentifierKBO.localId =
      event.target.inputmask.unmaskedvalue();
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
      address,
      contact,
      secondaryContact,
      identifierSharepoint,
      identifierKBO,
      structuredIdentifierSharepoint,
      structuredIdentifierKBO,
    } = this.model;

    // NOTE (05/06/2025): Explicitly set the scope to `undefined` when the user
    // did not select any locations, or removed all originally set
    // locations. Otherwise, any edits are ignored and the previously set scope
    // of operation is just silently kept.
    // When the locations could not be loaded (`locationsInScope` is null)
    // the werkingsgebied is not touched: an empty selection then means
    // "unknown", not "cleared by the user".
    if (this.locationsInScope !== null) {
      try {
        organization.scope =
          this.locationsInScope?.length > 0
            ? await this.scopeOfOperation.getScopeForLocations(
                ...this.locationsInScope,
              )
            : undefined;
      } catch (error) {
        if (error instanceof ScopeOfOperationError) {
          this.saveError = error.message;
          return;
        }
        throw error;
      }
    }

    await Promise.all([
      organization.validate({ relaxMandatoryFoundingOrganization: true }),
      identifierSharepoint.validate(),
    ]);

    const requiresKboNumber = requiresKbo(organization);

    if (requiresKboNumber) {
      await identifierKBO.validate();
    }

    const isContactDataEditable =
      this.features.isEnabled('edit-contact-data') ||
      isContactEditableOrganization(this.model.organization);

    if (isContactDataEditable) {
      await Promise.all([
        address.validate(),
        contact.validate(),
        secondaryContact.validate(),
      ]);
    }

    if (!this.hasValidationErrors) {
      // The records of the change request, dependencies first: the address
      // and the contact points before the site, the structured identifiers
      // before their identifiers, the organisation last.
      const records = [];
      let primarySite = null;

      if (isContactDataEditable) {
        primarySite = await organization.primarySite;

        // TODO: "if" not needed when the data of all organizations will be
        // correct they should all have a primary site on creation
        if (!primarySite) {
          primarySite = this.store.createRecord('site');
          primarySite.address = address;
          organization.primarySite = primarySite;
        }

        if (address.hasDirtyAttributes) {
          if (!address.isPostcodeInFlanders) {
            address.province = '';
          }
          address.fullAddress = combineFullAddress(address);
          records.push(setEmptyStringsToNull(address));
        }

        let siteContacts = await primarySite.contacts;
        let isSiteChanged = primarySite.isNew;

        // The route creates a contact point the site lacks; it is only
        // added when the user filled it in.
        for (let contactPoint of [contact, secondaryContact]) {
          if (hasUserInput(contactPoint, ['type'])) {
            if (contactPoint.isNew) {
              siteContacts.push(contactPoint);
              isSiteChanged = true;
            }
            records.push(setEmptyStringsToNull(contactPoint));
          }
        }

        if (isSiteChanged) {
          records.push(primarySite);
        }
      }

      if (requiresKboNumber) {
        records.push(setEmptyStringsToNull(structuredIdentifierKBO));
        records.push(identifierKBO);
      }

      // FIXME: If uncommented existing SharePoint identifier is not removed
      // when user removes the value in the form. Commenting it a quick, dirty
      // fix because it overwrites the previous value with an empty string
      // instead of leaving it untouched.
      // structuredIdentifierSharepoint = setEmptyStringsToNull(
      //   structuredIdentifierSharepoint,
      // );
      // The route creates the SharePoint identifier when the organisation
      // has none; it is only created when the user filled it in, otherwise
      // it stays out of the request, and so out of `identifiers`.
      if (
        !identifierSharepoint.isNew ||
        hasUserInput(structuredIdentifierSharepoint)
      ) {
        records.push(structuredIdentifierSharepoint);
        records.push(identifierSharepoint);
      }

      records.push(setEmptyStringsToNull(organization));

      let saved;
      try {
        saved = await this.changeRequests.submit(
          'organization-core-data',
          organization.id,
          records,
        );
      } catch (error) {
        if (!(error instanceof ChangeRequestError)) {
          throw error;
        }
        if (error.applied) {
          // The change is in the application graph but the page could not
          // follow it up; leave it, the index page loads the applied state.
          this.toaster.warning(error.message, 'Wijziging doorgevoerd');
          this.leave(organization.id);
          return;
        }
        if (error.held) {
          // Nothing is applied and the submitted records are back at the
          // backend's state.
          await this.showHeldRequest(
            heldRequestNotice(error, this.fieldLabels(primarySite)),
          );
          return;
        }
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown, a retry could apply the change
        // twice, or the apply failed, which `reapply` retries.
        this.saveError = error.message;
        this.saveBlocked = error.outcomeUnknown || error.applyFailed;
        this.failedRequestId = error.applyFailed ? error.requestId : null;
        return;
      }

      if (requiresKboNumber) {
        await this.syncKboData(saved.get(structuredIdentifierKBO).id);
      }

      this.leave(organization.id);
    }
  });

  /**
   * Apply the request whose apply failed on the last save again (a
   * hertoepassing of what was submitted, see `failedRequestId`). Once it is
   * applied the page is left, as after a save. Unless the service refuses
   * it, it can be tried again; a refusal needs a reload.
   */
  reapply = dropTask(async () => {
    const { organization, structuredIdentifierKBO } = this.model;
    this.saveError = null;

    try {
      await this.changeRequests.reapply(this.failedRequestId);
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      this.saveError = error.message;
      if (error.refused) {
        // Not to be tried again: the page must be reloaded
        this.failedRequestId = null;
      }
      return;
    }

    // A KBO number the request created has an id the page does not know,
    // as after an `applied` error; it is synced on the next save.
    if (requiresKbo(organization) && !structuredIdentifierKBO.isNew) {
      await this.syncKboData(structuredIdentifierKBO.id);
    }
    this.toaster.success(
      'De wijziging is doorgevoerd.',
      'Wijziging doorgevoerd',
    );
    this.leave(organization.id);
  });

  /**
   * Show the page anew after the change-request service held the save:
   * refresh the core-data route, whose model hook reloads the organisation
   * with everything the form shows (also the records the request did not
   * contain), build the form again from them and show the notice.
   * Refreshing resets this controller (the route's `willTransition`), so the
   * notice is set afterwards. When the refresh fails, the router shows the
   * error page, where the notice would not be seen.
   *
   * @param {Object} heldRequest - see `heldRequest`
   */
  async showHeldRequest(heldRequest) {
    try {
      await this.router.refresh('organizations.organization.core-data');
    } catch (error) {
      reportHeldRequest(this.toaster, error);
      return;
    }
    this.formRevision += 1;
    this.heldRequest = heldRequest;
    this.saveBlocked = heldRequest.reloadFailed;
  }

  async syncKboData(structuredIdentifierId) {
    await fetch(`/kbo-data-sync/${structuredIdentifierId}`, {
      method: 'POST',
    });
  }

  /**
   * The records of the page with the labels it gives their fields, to name
   * the fields of a held change request.
   *
   * @param {Model|null} primarySite - the primary site the request was about
   */
  fieldLabels(primarySite) {
    const {
      organization,
      address,
      contact,
      secondaryContact,
      structuredIdentifierKBO,
      structuredIdentifierSharepoint,
    } = this.model;

    return [
      [organization, ORGANIZATION_CORE_DATA_LABELS],
      [primarySite, PRIMARY_SITE_LABELS],
      [address, ADDRESS_LABELS],
      [contact, PRIMARY_CONTACT_LABELS],
      [secondaryContact, SECONDARY_CONTACT_LABELS],
      [structuredIdentifierKBO, { 'local-id': ID_NAME.KBO }],
      [structuredIdentifierSharepoint, { 'local-id': ID_NAME.SHAREPOINT }],
    ];
  }

  leave(organizationId) {
    this.router.refresh();
    this.router.transitionTo(
      'organizations.organization.core-data',
      organizationId,
    );
  }

  resetUnsavedRecords() {
    let {
      organization,
      address,
      contact,
      secondaryContact,
      identifierSharepoint,
      identifierKBO,
      structuredIdentifierSharepoint,
      structuredIdentifierKBO,
    } = this.model;

    // Relationship changes of this page, such as a new primary site or
    // identifier, are discarded along with the records they point to.
    this.changeRequests.rollbackRelationships(organization);

    // New records are unloaded once the change request that created them is
    // applied, so they may be gone by the time the page is left.
    for (let record of [
      organization,
      contact,
      secondaryContact,
      address,
      identifierKBO,
      identifierSharepoint,
    ]) {
      if (isLoaded(record)) {
        record.reset();
      }
    }
    for (let record of [
      structuredIdentifierKBO,
      structuredIdentifierSharepoint,
    ]) {
      if (isLoaded(record)) {
        record.rollbackAttributes();
      }
    }
  }

  reset() {
    this.resetUnsavedRecords();
    this.locationsInScope = [];
    this.saveError = null;
    this.saveBlocked = false;
    this.heldRequest = null;
    this.failedRequestId = null;
  }
}
