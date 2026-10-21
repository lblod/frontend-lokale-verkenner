import Controller from '@ember/controller';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { findAll } from '@warp-drive/legacy/compat/builders';
import { combineFullAddress } from 'frontend-organization-portal/models/address';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import isContactEditableOrganization from 'frontend-organization-portal/utils/editable-contact-data';
import {
  ChangeRequestError,
  kboConflictMessage,
} from 'frontend-organization-portal/services/change-requests';
import { isLoaded } from 'frontend-organization-portal/utils/records';
import requiresKbo from '../../helpers/requires-kbo';

/**
 * The site type "Maatschappelijke zetel", which OP gives the primary site of
 * a new organisation of some types (see `registeredOfficeTypeFor`).
 */
const MAATSCHAPPELIJKE_ZETEL = 'f1381723dec42c0b6ba6492e41d6f5dd';

/**
 * The message for a request whose outcome is unknown.
 */
const OUTCOME_UNKNOWN_MESSAGE =
  'Het is niet zeker of je aanvraag werd verwerkt. Herlaad de pagina en kijk onder "Alle aanvragen" of ze werd ontvangen voor je ze opnieuw verstuurt.';

/**
 * The form that requests a new organisation: the organisation with its
 * KBO and SharePoint identifiers, its primary site with address and contact
 * points, and its oprichting as a change event with its date, its result and
 * the link to the besluit, submitted as one change request (aggregate
 * `new-organisation`). The service checks that the session may request an
 * organisation of the chosen classification ("Wie beheert") and that the KBO
 * number is free. A request by ABB is applied at once and the page goes to
 * the new organisation; anyone else's request waits for ABB and the page
 * goes to the request.
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
   * Set when the service refused the KBO number, registered or requested
   * already: `{ message }`, shown on the field. It is not a validation
   * error of the form, which would say a required field is empty.
   */
  @tracked kboConflict = null;

  /**
   * Whether sending is blocked until the page is reloaded: the last attempt
   * ended without knowing whether the service recorded or applied it (a
   * 5xx, no answer), and a new one could register the organisation twice.
   */
  @tracked saveBlocked = false;

  /**
   * The result of the oprichting the last attempt created, unloaded before
   * the next one and when the page is left.
   */
  changeEventResult = null;

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
      this.model.changeEvent.error ||
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
    this.kboConflict = null;
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
        // A bestuurseenheid in the register, which OP creates as a bare
        // organisation; the change-request service registers only
        // administrative units and registered organisations
        CLASSIFICATION.VLAAMSE_GEMEENSCHAPSCOMMISSIE.id,
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
    if (this.saveBlocked) {
      return;
    }
    this.saveError = null;
    this.kboConflict = null;

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

    // A link the user added but left empty is no link
    decision.documentLinks = decision.documentLinks.filter((link) =>
      link?.trim(),
    );

    const requiresKboNumber = requiresKbo(organization);
    await Promise.all([
      organization.validate(),
      requiresKboNumber
        ? identifierKBO.validate()
        : identifierKBO.resetErrors(),
      identifierSharepoint.validate(),
      // The date of the oprichting, which a new change event requires
      changeEvent.validate(),
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

    let siteType = null;
    if (this.contactDataEditable) {
      try {
        siteType = await this.registeredOfficeTypeFor(organization);
      } catch (error) {
        console.error('The site types could not be loaded:', error);
        this.saveError =
          'De types van vestigingen konden niet geladen worden. Probeer opnieuw.';
        return;
      }
    }

    // The records of the request, dependencies first. Relationships are
    // assigned rather than added to, so that an attempt after a refusal
    // sends the same.
    const records = [];
    const identifiers = [];
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
    organization.identifiers = identifiers;
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
      primarySite.contacts = [contact, secondaryContact];
      primarySite.siteType = siteType;
      records.push(primarySite);
      // The primary site only: `sites` holds the other ones, as in OP
      organization.primarySite = primarySite;
    }
    // The oprichting results in the organisation, with the status it starts
    // with: the organisation's page lists its change events through their
    // results, as the change-event form records them
    if (isLoaded(this.changeEventResult) && this.changeEventResult.isNew) {
      this.changeEventResult.unloadRecord();
    }
    const changeEventResult = this.store.createRecord('change-event-result', {
      status: await organization.organizationStatus,
      resultingOrganization: organization,
      resultFrom: changeEvent,
    });
    this.changeEventResult = changeEventResult;
    changeEvent.originalOrganizations = [organization];
    changeEvent.resultingOrganizations = [organization];
    // The besluit, when one was filled in
    changeEvent.decision = decision.isEmpty ? null : decision;
    if (!decision.isEmpty) {
      records.push(decision);
    }
    records.push(
      changeEvent,
      changeEventResult,
      setEmptyStringsToNull(organization),
    );

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
      if (error.applied) {
        // ABB's organisation is registered, but the page could not follow
        // it up: the request shows it
        this.toaster.warning(error.message, 'Organisatie toegevoegd');
        if (error.requestId) {
          this.router.replaceWith('aanvragen.aanvraag', error.requestId);
        } else {
          this.router.replaceWith('organizations');
        }
        return;
      }
      if (error.applyFailed && error.requestId) {
        // ABB's request is kept, but registering the organisation failed:
        // the request page shows why
        this.toaster.warning(error.message, 'Doorvoeren mislukt');
        this.router.replaceWith('aanvragen.aanvraag', error.requestId);
        return;
      }
      if (error.held && error.waiting && error.requestId) {
        // Recorded: the request waits
        if (this.appliesAtOnce) {
          // ABB's own request waits when data it changes was changed
          // meanwhile: ABB reviews the differences on the request page
          this.toaster.warning(
            'De aanvraag is bewaard, maar nog niet doorgevoerd: intussen werden gegevens gewijzigd die ze ook wijzigt. Bekijk de verschillen en keur de aanvraag goed.',
            'Aanvraag wacht op goedkeuring',
          );
        } else {
          this.toaster.success(
            'De aanvraag is verstuurd en wordt gevalideerd door ABB.',
            'Aanvraag verstuurd',
          );
        }
        this.router.replaceWith('aanvragen.aanvraag', error.requestId);
        return;
      }
      if (error.held) {
        // Not recorded, and the records of the form are gone: the page
        // must be reloaded
        this.saveError = error.message;
        this.saveBlocked = true;
        return;
      }
      const kboMessage = kboConflictMessage(error.errors);
      if (kboMessage) {
        this.kboConflict = { message: kboMessage };
        this.saveError =
          'De aanvraag werd niet verstuurd. Controleer het KBO-nummer.';
        return;
      }
      // Refused: the form keeps its values for a correction. When the
      // outcome is unknown only a reload tells whether to send it again.
      this.saveError = error.outcomeUnknown
        ? OUTCOME_UNKNOWN_MESSAGE
        : error.message;
      this.saveBlocked = error.outcomeUnknown;
      return;
    }

    // ABB's request is applied at once: the organisation exists
    this.router.replaceWith(
      'organizations.organization',
      saved.get(organization).id,
    );
  });

  /**
   * The site type of the primary site of a new organisation: as in OP,
   * "Maatschappelijke zetel" for an AGB, APB, IGS, politiezone,
   * hulpverleningszone, OCMW-vereniging, PEVA or Andere, none for the
   * others. The type is looked up among the site types, as OP does: a code
   * list that lacks it leaves the site without type.
   *
   * @param {OrganizationModel} organization
   * @returns {Promise<SiteTypeModel|null>}
   */
  async registeredOfficeTypeFor(organization) {
    if (!(
      organization.isAgb ||
      organization.isApb ||
      // OP reads `isIGS`, which no model has, so OP leaves an IGS
      // without type
      organization.isIgs ||
      organization.isPoliceZone ||
      organization.isAssistanceZone ||
      organization.isOcmwAssociation ||
      organization.isPevaMunicipality ||
      organization.isPevaProvince ||
      organization.isAndere
    )) {
      return null;
    }
    const { content: siteTypes } = await this.store.request(
      findAll('site-type'),
    );
    return siteTypes.find((type) => type.id === MAATSCHAPPELIJKE_ZETEL) ?? null;
  }

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
      this.changeEventResult,
    ]) {
      if (isLoaded(record) && record.isNew) {
        record.deleteRecord();
        record.unloadRecord();
      }
    }
    this.changeEventResult = null;
    this.locations = null;
    this.reason = '';
    this.saveError = null;
    this.kboConflict = null;
    this.saveBlocked = false;
  }
}
