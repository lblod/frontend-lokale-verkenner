import Controller from '@ember/controller';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { tracked } from '@glimmer/tracking';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import { isLoaded } from 'frontend-organization-portal/utils/records';
import { action } from '@ember/object';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

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
   * Whether the last save ended without knowing whether the site was created
   * (a 5xx); a retry could create it twice, so saving stays blocked until
   * the page is reloaded.
   */
  @tracked saveBlocked = false;

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
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown: a retry could create the site twice.
        this.saveError = error.message;
        this.saveBlocked = error.outcomeUnknown;
        return;
      }

      this.router.replaceWith(
        'organizations.organization.sites.site',
        saved.get(site).id,
      );
    }
  });

  reset() {
    this.isPrimarySite = false;
    this.saveError = null;
    this.saveBlocked = false;
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
