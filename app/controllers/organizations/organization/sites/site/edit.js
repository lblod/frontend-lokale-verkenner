import Controller from '@ember/controller';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import { isLoaded } from 'frontend-organization-portal/utils/records';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

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
   * Whether the last save ended without knowing whether the change was
   * applied (a 5xx); a retry could apply it twice, so saving stays blocked
   * until the page is reloaded.
   */
  @tracked saveBlocked = false;

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

      for (let contactPoint of [contact, secondaryContact]) {
        if (contactPoint.hasDirtyAttributes) {
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
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown: a retry could apply the change twice.
        this.saveError = error.message;
        this.saveBlocked = error.outcomeUnknown;
        return;
      }

      this.router.transitionTo(
        'organizations.organization.sites.site',
        site.id,
      );
    }
  });

  reset() {
    this.resetUnsavedRecords();
    this.isNoPrimarySiteErrorMessage = null;
    this.saveError = null;
    this.saveBlocked = false;
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
