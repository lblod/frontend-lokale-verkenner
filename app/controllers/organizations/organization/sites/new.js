import Controller from '@ember/controller';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { tracked } from '@glimmer/tracking';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import { isLoaded } from 'frontend-organization-portal/utils/records';
import { action } from '@ember/object';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import {
  ORGANIZATION_SITE_LABELS,
  heldRequestNotice,
  reportHeldRequest,
} from 'frontend-organization-portal/utils/change-request-conflicts';

export default class OrganizationsOrganizationSitesNewController extends Controller {
  @service router;
  @service store;
  @service changeRequests;
  @service toaster;
  @tracked isPrimarySite = false;
  /**
   * The message of the change-request service when it refused the last save.
   */
  @tracked saveError;
  /**
   * Whether saving is blocked until the page is reloaded: the last save
   * ended without knowing whether the site was created (a 5xx), and a retry
   * could create it twice; its apply failed (see `failedRequestId`); or it
   * was held and the organisation could not be reloaded, so a new save would
   * start from sites that are not the current ones.
   */
  @tracked saveBlocked = false;
  /**
   * Set when the change-request service held the last save instead of
   * applying it, because someone else changed the sites of the organisation
   * in the meantime: `{ id, fields, reloadFailed }`, the request and the
   * labels of those fields (see `heldRequestNotice`). The site is not
   * created; the request waits for a decision by ABB.
   */
  @tracked heldRequest = null;
  /**
   * The uuid of the request whose apply failed on the last save (a 409 with
   * status mislukt). The service kept it; saving is blocked, `reapply`
   * applies the kept request again.
   */
  @tracked failedRequestId = null;
  /**
   * Bumped once the page has started anew after a held save, so that the
   * template builds the form anew (`<Rebuild>`): some of its components (the
   * address search) keep the values they were created with.
   */
  @tracked formRevision = 0;

  get hasValidationErrors() {
    return (
      this.model.site.error ||
      this.model.address.error ||
      this.model.contact.error ||
      this.model.secondaryContact.error
    );
  }

  createSiteTask = dropTask(async (event) => {
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
      if (!address.isPostcodeInFlanders) {
        address.province = '';
      }
      address.fullAddress = combineFullAddress(address);

      site.address = address;
      (await site.contacts).push(contact, secondaryContact);

      let nonPrimarySites = await organization.sites;

      if (this.isPrimarySite) {
        let previousPrimarySite = await organization.primarySite;

        if (previousPrimarySite) {
          nonPrimarySites.push(previousPrimarySite);
        }

        organization.primarySite = site;
      } else {
        nonPrimarySites.push(site);
      }

      // Dependencies first: the contact points and the address before the
      // site, the site before the organisation that links it.
      const records = [
        setEmptyStringsToNull(contact),
        setEmptyStringsToNull(secondaryContact),
        setEmptyStringsToNull(address),
        site,
        organization,
      ];

      let saved;
      try {
        saved = await this.changeRequests.submit(
          'site',
          organization.id,
          records,
        );
      } catch (error) {
        if (!(error instanceof ChangeRequestError)) {
          throw error;
        }
        if (error.applied) {
          // The site is created but the page could not follow it up; leave
          // it, the list of sites loads the applied state.
          this.toaster.warning(error.message, 'Wijziging doorgevoerd');
          this.router.refresh();
          this.router.replaceWith(
            'organizations.organization.sites',
            organization.id,
          );
          return;
        }
        if (error.held) {
          // Nothing is created: the new records are unloaded and the
          // organisation is back at the backend's state.
          await this.showHeldRequest(
            heldRequestNotice(error, [
              [organization, ORGANIZATION_SITE_LABELS],
            ]),
          );
          return;
        }
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown, a retry could create the site
        // twice, or the apply failed, which `reapply` retries.
        this.saveError = error.message;
        this.saveBlocked = error.outcomeUnknown || error.applyFailed;
        this.failedRequestId = error.applyFailed ? error.requestId : null;
        return;
      }

      this.router.replaceWith(
        'organizations.organization.sites.site',
        saved.get(site).id,
      );
    }
  });

  /**
   * Apply the request whose apply failed on the last save again (a
   * hertoepassing of what was submitted, see `failedRequestId`). Once it is
   * applied the list of sites is opened: the uuid the service minted for the
   * site is in the answer to the submit only. Unless the service refuses
   * it, it can be tried again; a refusal needs a reload.
   */
  reapply = dropTask(async () => {
    const { organization } = this.model;
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

    this.toaster.success(
      'De vestiging is toegevoegd.',
      'Wijziging doorgevoerd',
    );
    this.router.refresh();
    this.router.replaceWith(
      'organizations.organization.sites',
      organization.id,
    );
  });

  /**
   * Start the page anew after the change-request service held the save:
   * refreshing the route creates new records for the form, which is built
   * again, and the notice says why the site was not added. Refreshing resets
   * this controller (`resetController`), so the notice is set afterwards.
   * When the refresh fails, the router shows the error page, where the
   * notice would not be seen.
   *
   * @param {Object} heldRequest - see `heldRequest`
   */
  async showHeldRequest(heldRequest) {
    try {
      await this.router.refresh('organizations.organization.sites.new');
    } catch (error) {
      reportHeldRequest(this.toaster, error);
      return;
    }
    this.formRevision += 1;
    this.heldRequest = heldRequest;
    this.saveBlocked = heldRequest.reloadFailed;
  }

  reset() {
    this.isPrimarySite = false;
    this.saveError = null;
    this.saveBlocked = false;
    this.heldRequest = null;
    this.failedRequestId = null;
    this.removeUnsavedRecords();
  }

  removeUnsavedRecords() {
    let { site, address, contact, secondaryContact, organization } = this.model;

    // The site the page added to the organisation goes with it
    this.changeRequests.rollbackRelationships(organization);

    // Once the change request that created them is applied the new records
    // are unloaded already.
    for (let record of [site, address, contact, secondaryContact]) {
      if (isLoaded(record) && record.isNew) {
        record.deleteRecord();
        record.unloadRecord();
      }
    }
  }

  @action
  setSiteTypeName(e) {
    this.model.site.siteTypeName = e.target.value;
  }
}
