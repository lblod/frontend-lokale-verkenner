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
import { isLoaded } from 'frontend-organization-portal/utils/records';
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
   * Whether the last save ended without knowing whether the change was
   * applied (a 5xx); a retry could apply it twice, so saving stays blocked
   * until the page is reloaded.
   */
  @tracked saveBlocked = false;

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

      if (isContactDataEditable) {
        let primarySite = await organization.primarySite;

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

        for (let contactPoint of [contact, secondaryContact]) {
          if (contactPoint.hasDirtyAttributes) {
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
      records.push(structuredIdentifierSharepoint);
      records.push(identifierSharepoint);

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
        // The records keep their edits so the user can correct and retry,
        // unless the outcome is unknown: a retry could apply the change twice.
        this.saveError = error.message;
        this.saveBlocked = error.outcomeUnknown;
        return;
      }

      if (requiresKboNumber) {
        const syncKboData = `/kbo-data-sync/${saved.get(structuredIdentifierKBO).id}`;
        await fetch(syncKboData, {
          method: 'POST',
        });
      }

      this.leave(organization.id);
    }
  });

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
  }
}
