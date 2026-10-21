import Controller from '@ember/controller';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import {
  hasUserInput,
  isLoaded,
} from 'frontend-organization-portal/utils/records';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import {
  ADDRESS_LABELS,
  ORGANIZATION_SITE_LABELS,
  PRIMARY_CONTACT_LABELS,
  SECONDARY_CONTACT_LABELS,
  SITE_LABELS,
  heldRequestNotice,
  reportHeldRequest,
} from 'frontend-organization-portal/utils/change-request-conflicts';

export default class OrganizationsOrganizationSitesSiteEditController extends Controller {
  @service router;
  @service store;
  @service changeRequests;
  @service toaster;
  @tracked isPrimarySite;
  @tracked isNoPrimarySiteErrorMessage;
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
   * blocked and the page links to the kept request, where it can be
   * withdrawn: edits are not listed in "Alle aanvragen".
   */
  @tracked failedRequestId = null;
  /**
   * Bumped once the records are reloaded after a held save, so that the
   * template builds the form anew (`<Rebuild>`): some of its components (the
   * address search) keep the values they were created with.
   */
  @tracked formRevision = 0;

  get isCurrentPrimarySite() {
    return this.model.site.id === this.model.currentPrimarySite?.id;
  }

  setup() {
    this.isPrimarySite = this.isCurrentPrimarySite;
  }

  get hasValidationErrors() {
    return (
      this.model.site.error ||
      this.model.address.error ||
      this.model.contact.error ||
      this.model.secondaryContact.error
    );
  }

  @action
  updateIsPrimarySite(isPrimarySite) {
    this.isPrimarySite = isPrimarySite;
    if (
      !this.isPrimarySite &&
      (!this.model.organization.primarySite?.get('id') ||
        this.isCurrentPrimarySite)
    ) {
      this.isNoPrimarySiteErrorMessage =
        'Deze vestiging wordt automatisch als primair contactadres aangeduid omdat er nog geen primair contactadres aangeduid is.';
      setTimeout(() => (this.isPrimarySite = true), 50);
    }
  }

  save = dropTask(async (event) => {
    event.preventDefault();
    if (this.saveBlocked) {
      return;
    }
    this.saveError = null;
    this.heldRequest = null;

    let { address, organization, contact, secondaryContact, site } = this.model;

    await site.validate();
    await address.validate();
    await contact.validate();
    await secondaryContact.validate();

    if (!this.hasValidationErrors) {
      // The records of the change request, dependencies first: the address
      // and the contact points before the site, the organisation last.
      const records = [];

      if (address.hasDirtyAttributes) {
        if (!address.isPostcodeInFlanders) {
          address.province = '';
        }
        address.fullAddress = combineFullAddress(address);
        records.push(setEmptyStringsToNull(address));
      }

      // The route creates a contact point the site lacks; it is only added
      // when the user filled it in.
      for (let contactPoint of [contact, secondaryContact]) {
        if (hasUserInput(contactPoint, ['type'])) {
          if (contactPoint.isNew) {
            (await site.contacts).push(contactPoint);
          }
          records.push(setEmptyStringsToNull(contactPoint));
        }
      }

      records.push(site);

      let nonPrimarySites = await organization.sites;
      let isOrganizationChanged = false;

      if (this.isCurrentPrimarySite && !this.isPrimarySite) {
        nonPrimarySites.push(site);
        organization.primarySite = null;
        isOrganizationChanged = true;
      } else if (this.isPrimarySite && !this.isCurrentPrimarySite) {
        let previousPrimarySite = this.model.currentPrimarySite;

        if (previousPrimarySite) {
          nonPrimarySites.push(previousPrimarySite);
        }

        organization.primarySite = site;
        const oldSite = nonPrimarySites.find(
          (nonPrimarySite) => nonPrimarySite.id === site.id,
        );
        const oldSiteIndex = nonPrimarySites.indexOf(oldSite);
        if (oldSiteIndex > -1) {
          nonPrimarySites.splice(oldSiteIndex, 1);
        }
        isOrganizationChanged = true;
      }

      // force it to be primary site if there is no primary site
      if (!organization.primarySite?.get('id')) {
        organization.primarySite = site;
        const siteIndex = nonPrimarySites.indexOf(site);
        if (siteIndex > -1) {
          nonPrimarySites.splice(siteIndex, 1);
        }
        isOrganizationChanged = true;
      }

      if (isOrganizationChanged) {
        records.push(organization);
      }

      // Nothing changed: no request, the page is left as after a save
      if (!this.changeRequests.hasChanges(records)) {
        this.router.transitionTo(
          'organizations.organization.sites.site',
          site.id,
        );
        return;
      }

      try {
        await this.changeRequests.submit('site', organization.id, records);
      } catch (error) {
        if (!(error instanceof ChangeRequestError)) {
          throw error;
        }
        if (error.applied) {
          // The change is in the application graph but the page could not
          // follow it up; leave it, the page of the site loads the applied
          // state.
          this.toaster.warning(error.message, 'Wijziging doorgevoerd');
          this.router.refresh();
          this.router.transitionTo(
            'organizations.organization.sites.site',
            site.id,
          );
          return;
        }
        if (error.held) {
          // Nothing is applied and the submitted records are back at the
          // backend's state.
          await this.showHeldRequest(
            heldRequestNotice(error, this.fieldLabels()),
          );
          return;
        }
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown, a retry could apply the change
        // twice, or the apply failed: the page links to the kept request.
        this.saveError = error.message;
        this.saveBlocked = error.outcomeUnknown || error.applyFailed;
        this.failedRequestId = error.applyFailed ? error.requestId : null;
        return;
      }

      this.router.transitionTo(
        'organizations.organization.sites.site',
        site.id,
      );
    }
  });

  /**
   * Show the page anew after the change-request service held the save:
   * refresh the site's route, whose model hook reloads the site with its
   * address and contact points (also the ones the request did not contain;
   * this route's model hook reloads the organisation's sites), build the
   * form again from them and show the notice. Refreshing resets this
   * controller (`resetController`), so the notice is set afterwards. When
   * the refresh fails, the router shows the error page, where the notice
   * would not be seen.
   *
   * @param {Object} heldRequest - see `heldRequest`
   */
  async showHeldRequest(heldRequest) {
    try {
      await this.router.refresh('organizations.organization.sites.site');
    } catch (error) {
      reportHeldRequest(this.toaster, error, heldRequest.waiting);
      return;
    }
    this.formRevision += 1;
    this.heldRequest = heldRequest;
    this.saveBlocked = heldRequest.reloadFailed;
  }

  /**
   * The records of the page with the labels it gives their fields, to name
   * the fields of a held change request.
   */
  fieldLabels() {
    const { site, address, contact, secondaryContact, organization } =
      this.model;

    return [
      [site, SITE_LABELS],
      [address, ADDRESS_LABELS],
      [contact, PRIMARY_CONTACT_LABELS],
      [secondaryContact, SECONDARY_CONTACT_LABELS],
      [organization, ORGANIZATION_SITE_LABELS],
    ];
  }

  reset() {
    this.resetUnsavedRecords();
    this.isNoPrimarySiteErrorMessage = null;
    this.saveError = null;
    this.saveBlocked = false;
    this.heldRequest = null;
    this.failedRequestId = null;
  }

  resetUnsavedRecords() {
    let { address, organization, contact, secondaryContact, site } = this.model;

    // The primary site change and the contact points the page added are
    // discarded along with the records they point to.
    this.changeRequests.rollbackRelationships(organization);
    this.changeRequests.rollbackRelationships(site);

    // Once the change request that created them is applied the new contact
    // points are unloaded already.
    for (let record of [
      address,
      organization,
      contact,
      secondaryContact,
      site,
    ]) {
      if (isLoaded(record)) {
        record.reset();
      }
    }
  }

  @action
  setSiteTypeName(e) {
    this.model.site.siteTypeName = e.target.value;
  }
}
