import Controller from '@ember/controller';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import isContactEditableOrganization from 'frontend-organization-portal/utils/editable-contact-data';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { isLoaded } from 'frontend-organization-portal/utils/records';
import requiresKbo from '../../helpers/requires-kbo';

/**
 * The form that requests a new organisation: the organisation with its
 * KBO and SharePoint identifiers, its primary site with address and contact
 * points, and its oprichting as a change event with the link to the
 * besluit, submitted as one change request (aggregate `new-organisation`).
 * The service checks that the session may request an organisation of the
 * chosen classification ("Wie beheert") and that the KBO number is free. A
 * request by ABB is applied at once and the page goes to the new
 * organisation; anyone else's request waits for ABB and the page goes to the
 * request.
 *
 * The related organisations of the new one (its founder, its members) are
 * not part of the request yet: they follow with the related-organisations
 * work. The werkingsgebied comes from the scope-of-operation service, as in
 * OP: one location for the picked locations.
 */
export default class OrganizationsNewController extends Controller {
  @service router;
  @service store;
  @service features;
  @service scopeOfOperation;
  @service changeRequests;
  @service toaster;

  @tracked currentOrganizationModel;

  /**
   * The locations picked as werkingsgebied.
   */
  @tracked locations;

  /**
   * The submitter's explanation, kept on the request for ABB.
   */
  @tracked reason = '';

  /**
   * The message of the change-request service when it refused the request.
   */
  @tracked saveError = null;

  /**
   * The classifications the session may request a new organisation of, as
   * ids. The service names them as URIs, whose last segment is the uuid of
   * the code: OP mints every classification code as its base plus the uuid.
   */
  get allowedClassificationIds() {
    return (this.changeRequests.rights?.canCreate ?? []).map((uri) =>
      uri.slice(uri.lastIndexOf('/') + 1),
    );
  }

  /**
   * Whether the request is applied at once: ABB's own registration is, as
   * ABB decides on requests.
   */
  get appliesAtOnce() {
    return this.changeRequests.rights?.canDecide === true;
  }

  get submitLabel() {
    return this.appliesAtOnce ? 'Voeg toe' : 'Aanvraag versturen';
  }

  get contactDataEditable() {
    return (
      this.features.isEnabled('edit-contact-data') ||
      isContactEditableOrganization(this.currentOrganizationModel)
    );
  }

  get hasValidationErrors() {
    return Boolean(
      this.currentOrganizationModel.error ||
      this.model.address.error ||
      this.model.contact.error ||
      this.model.secondaryContact.error ||
      (requiresKbo(this.currentOrganizationModel) &&
        this.model.identifierKBO.error) ||
      this.model.identifierSharepoint.error ||
      this.model.decision.error,
    );
  }

  @action
  setNames(name) {
    this.currentOrganizationModel.setAbbName(name);
  }

  @action
  setAlternativeNames(names) {
    this.currentOrganizationModel.setAlternativeName(names);
  }

  @action
  setKbo(event) {
    this.model.structuredIdentifierKBO.localId =
      event.target.inputmask.unmaskedvalue();
  }

  @action
  setLegalForm(legalForm) {
    this.currentOrganizationModel.legalForm = legalForm;
  }

  @action
  setContentThemes(contentThemes) {
    this.currentOrganizationModel.contentThemes = contentThemes;
  }

  @action
  setLocations(locations) {
    this.locations = locations;
  }

  @action
  setReason(event) {
    this.reason = event.target.value;
  }

  /**
   * Update the organisation record to the model type that matches the
   * classification the user picked: a new record of that type with the
   * values entered so far (see OP's create form, from which this comes).
   *
   * @param {OrganizationClassificationCodeModel} classificationCode
   */
  @action
  organizationConverter(classificationCode) {
    if (
      classificationCode.id !== this.currentOrganizationModel.classification.id
    ) {
      const newOrganizationModelInstance = this.#createNewModelInstance(
        classificationCode.id,
      );
      this.#copyPropertiesToModel(newOrganizationModelInstance);
      newOrganizationModelInstance.classification = classificationCode;
      this.currentOrganizationModel.deleteRecord();
      this.currentOrganizationModel = newOrganizationModelInstance;
    }
  }

  #createNewModelInstance(classificationCodeId) {
    if (
      [
        CLASSIFICATION.ZIEKENHUISVERENIGING.id,
        CLASSIFICATION.VERENIGING_OF_VENNOOTSCHAP_VOOR_SOCIALE_DIENSTVERLENING
          .id,
        CLASSIFICATION.WOONZORGVERENIGING_OF_WOONZORGVENNOOTSCHAP.id,
        CLASSIFICATION.ZORGRAAD.id,
        CLASSIFICATION.REGIONAAL_ZORGPLATFORM.id,
        CLASSIFICATION.REGIONAAL_LANDSCHAP.id,
        CLASSIFICATION.BOSGROEP.id,
        CLASSIFICATION.WOONMAATSCHAPPIJ.id,
        CLASSIFICATION.ANDERE.id,
      ].includes(classificationCodeId)
    ) {
      return this.store.createRecord('registered-organization');
    } else if (
      [
        CLASSIFICATION.MUNICIPALITY.id,
        CLASSIFICATION.PROVINCE.id,
        CLASSIFICATION.OCMW.id,
        CLASSIFICATION.DISTRICT.id,
        CLASSIFICATION.AGB.id,
        CLASSIFICATION.APB.id,
        CLASSIFICATION.PROJECTVERENIGING.id,
        CLASSIFICATION.DIENSTVERLENENDE_VERENIGING.id,
        CLASSIFICATION.OPDRACHTHOUDENDE_VERENIGING.id,
        CLASSIFICATION.OPDRACHTHOUDENDE_VERENIGING_MET_PRIVATE_DEELNAME.id,
        CLASSIFICATION.POLICE_ZONE.id,
        CLASSIFICATION.ASSISTANCE_ZONE.id,
        CLASSIFICATION.WELZIJNSVERENIGING.id,
        CLASSIFICATION.AUTONOME_VERZORGINGSINSTELLING.id,
        CLASSIFICATION.PEVA_MUNICIPALITY.id,
        CLASSIFICATION.PEVA_PROVINCE.id,
        CLASSIFICATION.INTERLOKALE_VERENIGING.id,
        CLASSIFICATION.VERVOERREGIORAAD.id,
      ].includes(classificationCodeId)
    ) {
      return this.store.createRecord('administrative-unit');
    } else {
      return this.store.createRecord('organization');
    }
  }

  #copyPropertiesToModel(newOrganizationModel) {
    newOrganizationModel.name = this.currentOrganizationModel.name;
    newOrganizationModel.legalName = this.currentOrganizationModel.legalName;
    newOrganizationModel.alternativeName =
      this.currentOrganizationModel.alternativeName;
    newOrganizationModel.organizationStatus = this.currentOrganizationModel
      .belongsTo('organizationStatus')
      .value();
    newOrganizationModel.legalForm = this.currentOrganizationModel
      .belongsTo('legalForm')
      .value();

    // Only IGSs have an, optional, expected end date and/or goal
    if (newOrganizationModel.isIgs) {
      newOrganizationModel.expectedEndDate =
        this.currentOrganizationModel.expectedEndDate;
      if (this.currentOrganizationModel.purpose?.length) {
        newOrganizationModel.purpose = this.currentOrganizationModel.purpose;
      }
    }
  }

  submitRequestTask = dropTask(async (event) => {
    event.preventDefault();
    this.saveError = null;

    const organization = this.currentOrganizationModel;
    const {
      primarySite,
      address,
      contact,
      secondaryContact,
      identifierSharepoint,
      identifierKBO,
      structuredIdentifierSharepoint,
      structuredIdentifierKBO,
      changeEvent,
      decision,
    } = this.model;

    try {
      organization.scope =
        this.locations?.length > 0
          ? await this.scopeOfOperation.getScopeForLocations(...this.locations)
          : null;
    } catch (error) {
      this.saveError = error.message;
      return;
    }

    const requiresKboNumber = requiresKbo(organization);
    await Promise.all([
      organization.validate(),
      requiresKboNumber
        ? identifierKBO.validate()
        : identifierKBO.resetErrors(),
      identifierSharepoint.validate(),
      decision.validate(),
    ]);
    if (this.contactDataEditable) {
      await Promise.all([
        address.validate(),
        contact.validate(),
        secondaryContact.validate(),
      ]);
    }
    if (this.hasValidationErrors) {
      return;
    }

    // The records of the request, dependencies first
    const records = [];
    const identifiers = await organization.identifiers;
    if (requiresKboNumber) {
      records.push(
        setEmptyStringsToNull(structuredIdentifierKBO),
        identifierKBO,
      );
      identifiers.push(identifierKBO);
    }
    if (structuredIdentifierSharepoint.localId?.trim()) {
      records.push(
        setEmptyStringsToNull(structuredIdentifierSharepoint),
        identifierSharepoint,
      );
      identifiers.push(identifierSharepoint);
    }
    if (this.contactDataEditable) {
      if (!address.isPostcodeInFlanders) {
        address.province = '';
      }
      address.fullAddress = combineFullAddress(address);
      records.push(
        setEmptyStringsToNull(contact),
        setEmptyStringsToNull(secondaryContact),
        setEmptyStringsToNull(address),
      );
      primarySite.address = address;
      (await primarySite.contacts).push(contact, secondaryContact);
      records.push(primarySite);
      organization.primarySite = primarySite;
      (await organization.sites).push(primarySite);
    }
    records.push(decision, changeEvent, setEmptyStringsToNull(organization));
    (await changeEvent.originalOrganizations).push(organization);

    let saved;
    try {
      saved = await this.changeRequests.submit(
        'new-organisation',
        null,
        records,
        {
          reason: this.reason.trim() || null,
        },
      );
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      if (error.held && error.waiting && error.requestId) {
        // Recorded: the request waits for ABB
        this.toaster.success(
          'De aanvraag is verstuurd en wordt gevalideerd door ABB.',
          'Aanvraag verstuurd',
        );
        this.router.replaceWith('aanvragen.aanvraag', error.requestId);
        return;
      }
      const kboMessage = kboConflictMessage(error.errors);
      if (kboMessage) {
        identifierKBO.addError('structuredIdentifier', kboMessage);
      }
      this.saveError = error.message;
      return;
    }

    // ABB's request is applied at once: the organisation exists
    this.router.replaceWith(
      'organizations.organization',
      saved.get(organization).id,
    );
  });

  reset() {
    // Every record of the page is new. Once the request was submitted they
    // are unloaded already (`submit` discards them: they exist in the request,
    // or in the backend under the uuids it minted); the rest is dropped here.
    const { model } = this;
    for (const record of [
      this.currentOrganizationModel,
      model.primarySite,
      model.address,
      model.contact,
      model.secondaryContact,
      model.identifierKBO,
      model.structuredIdentifierKBO,
      model.identifierSharepoint,
      model.structuredIdentifierSharepoint,
      model.changeEvent,
      model.decision,
    ]) {
      if (isLoaded(record) && record.isNew) {
        record.deleteRecord();
        record.unloadRecord();
      }
    }
    this.locations = null;
    this.reason = '';
    this.saveError = null;
  }
}

/**
 * The message for a KBO number the service refuses: registered already, or
 * proposed by a request that waits (`meta["kbo-number"]` of the 409).
 */
export function kboConflictMessage(errors = []) {
  const error = errors.find((candidate) => candidate?.meta?.['kbo-number']);
  if (!error) {
    return null;
  }
  return error.meta.organisation
    ? 'Er bestaat al een organisatie met dit KBO-nummer.'
    : 'Er wacht al een aanvraag voor een organisatie met dit KBO-nummer.';
}
