import Controller from '@ember/controller';
import { dropTask } from 'ember-concurrency';
import { service } from '@ember/service';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { action } from '@ember/object';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import isContactEditableOrganization from 'frontend-organization-portal/utils/editable-contact-data';
import { tracked } from '@glimmer/tracking';
import {
  ChangeRequestError,
  kboConflictMessage,
} from 'frontend-organization-portal/services/change-requests';
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

/**
 * The fields of the organisation that change only through a
 * veranderingsgebeurtenis: the page shows them, and the change-request
 * service refuses a kerngegevens request that changes them.
 */
const CHANGE_EVENT_KEYS = ['legalForm', 'scope', 'additionalQualifications'];

export default class OrganizationsOrganizationCoreDataEditController extends Controller {
  @service router;
  @service store;
  @service features;
  @service changeRequests;
  @service toaster;

  /**
   * The message of the change-request service when it refused the last save.
   */
  @tracked saveError;
  /**
   * Set when the service refused the KBO number because another
   * organisation, or a creation that waits, has it: `{ message }`, shown on
   * the field. It is not a validation error of the form, which would say a
   * required field is empty.
   */
  @tracked kboConflict = null;
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
   * blocked until the page is reloaded.
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
    this.kboConflict = null;
  }

  save = dropTask(async (event) => {
    event.preventDefault();
    if (this.saveBlocked) {
      return;
    }
    this.saveError = null;
    this.kboConflict = null;
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

    // The juridische vorm, the werkingsgebied and the qualifications change
    // through a veranderingsgebeurtenis only: the request carries them as
    // they are, and a value the data lacks is not this page's to fill in.
    await Promise.all([
      organization.validate({ relaxMandatoryFoundingOrganization: true }),
      identifierSharepoint.validate(),
    ]);
    for (const key of CHANGE_EVENT_KEYS) {
      organization.removeError(key);
    }

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
        // Nothing changed: no request, the page is left as after a save
        if (!this.changeRequests.hasChanges(records)) {
          this.leave(organization.id);
          return;
        }
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
        const kboMessage = kboConflictMessage(error.errors);
        if (kboMessage) {
          // Another organisation has the number: shown on the field
          this.kboConflict = { message: kboMessage };
          this.saveError =
            'De wijziging werd niet opgeslagen. Controleer het KBO-nummer.';
          return;
        }
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown, a retry could apply the change
        // twice, or the apply failed: saving stays blocked.
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
      reportHeldRequest(this.toaster, error, heldRequest.waiting);
      return;
    }
    this.formRevision += 1;
    this.heldRequest = heldRequest;
    this.saveBlocked = heldRequest.reloadFailed;
  }

  /**
   * Have the KBO data of the organisation fetched from Wegwijs for its saved
   * KBO number (kbo-data-sync, as in OP). The change is applied by now, so a
   * sync that fails does not fail the save: the page leaves as after any
   * save, and the nightly sync of that service catches up.
   *
   * @param {string} structuredIdentifierId - uuid of the structured
   *     identifier that holds the KBO number
   */
  async syncKboData(structuredIdentifierId) {
    const url = `/kbo-data-sync/${structuredIdentifierId}`;
    try {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        console.warn(
          `The KBO data could not be synced: ${url} answered ${response.status}`,
        );
      }
    } catch (error) {
      console.warn(`The KBO data could not be synced: ${url} failed`, error);
    }
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
    this.saveError = null;
    this.kboConflict = null;
    this.saveBlocked = false;
    this.heldRequest = null;
    this.failedRequestId = null;
  }
}
