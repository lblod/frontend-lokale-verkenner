import Controller from '@ember/controller';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import {
  CHANGE_EVENT_TYPE,
  MultipleOrganizationTypeIdList,
  isNameChangeType,
} from 'frontend-organization-portal/models/change-event-type';
import { ORGANIZATION_STATUS } from 'frontend-organization-portal/models/organization-status-code';
import isAdditionalQualificationChangeEvent from 'frontend-organization-portal/helpers/is-additional-qualification-change-event';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import isMostRecentChangeEvent from 'frontend-organization-portal/utils/is-most-recent-change-event';
import { isLoaded } from 'frontend-organization-portal/utils/records';

/**
 * The status an organisation has after a change event of the type, as OP's
 * form sets it; a type that is not listed keeps the status.
 */
export const RESULTING_STATUS_FOR_CHANGE_EVENT_TYPE = {
  [CHANGE_EVENT_TYPE.NAME_CHANGE]: ORGANIZATION_STATUS.ACTIVE,
  [CHANGE_EVENT_TYPE.IN_ONTBINDING]: ORGANIZATION_STATUS.ACTIVE,
  [CHANGE_EVENT_TYPE.OPRICHTING]: ORGANIZATION_STATUS.ACTIVE,
  [CHANGE_EVENT_TYPE.IN_VEREFFENING]: ORGANIZATION_STATUS.ACTIVE,
  [CHANGE_EVENT_TYPE.ONTBONDEN_EN_VEREFFEND]: ORGANIZATION_STATUS.INACTIVE,
  [CHANGE_EVENT_TYPE.CITY]: ORGANIZATION_STATUS.ACTIVE,
  [CHANGE_EVENT_TYPE.GEOGRAPHICAL_AREA_CHANGE]: ORGANIZATION_STATUS.ACTIVE,
  [CHANGE_EVENT_TYPE.LEGAL_FORM_CHANGE]: ORGANIZATION_STATUS.ACTIVE,
};

const SAME_VALUE_ERROR_MESSAGE =
  'De huidige en nieuwe waarde kunnen niet hetzelfde zijn.';

/**
 * The form that requests a veranderingsgebeurtenis about one organisation:
 * the change event with its besluit, its result (the resulting status, legal
 * form, werkingsgebied, qualifications or name) and the fields of the
 * organisation the event changes, submitted as one change request
 * (aggregate `change-event`). The event is recorded and the organisation
 * changed when ABB approves; ABB's own request is applied at once.
 *
 * As in OP, the form shows the organisation's current name, legal form,
 * werkingsgebied or qualifications next to the new one, refuses a new value
 * that equals the current one, and keeps the current value on the result as
 * its original value.
 *
 * Events that involve several organisations (fusie, samenvoeging) are not
 * requests yet: the type select leaves them out. A new werkingsgebied comes
 * from the scope-of-operation service, as in OP. The relations of an
 * organisation that is dissolved are not ended here; they follow with the
 * related-organisations work.
 */
export default class OrganizationsOrganizationChangeEventsNewController extends Controller {
  @service router;
  @service store;
  @service scopeOfOperation;
  @service changeRequests;
  @service toaster;

  @tracked selectedResultingLegalForm;
  @tracked selectedResultingLocations = [];
  @tracked selectedResultingAdditionalQualifications = [];
  @tracked resultingName = null;

  /**
   * The submitter's explanation, kept on the request for ABB.
   */
  @tracked reason = '';

  /**
   * The message of the change-request service when it refused the request.
   */
  @tracked saveError = null;

  /**
   * Whether sending is blocked until the page is reloaded: the last attempt
   * ended without knowing whether the service recorded or applied it (a
   * 5xx, no answer), and a new one could register the event twice.
   */
  @tracked saveBlocked = false;

  /**
   * The result the last attempt created, unloaded when the page is left.
   */
  changeEventResult = null;

  /**
   * The locations within the werkingsgebied of the organisation, loaded when
   * the werkingsgebied type is chosen: they prefill the new werkingsgebied
   * and the new one must differ from them. Null when they were not loaded.
   */
  currentLocationsInScope = null;

  isNameChangeType = isNameChangeType;

  /**
   * The types a request cannot carry: those about several organisations.
   */
  excludedTypeIds = MultipleOrganizationTypeIdList;

  get hasValidationErrors() {
    return Boolean(this.model.changeEvent.error || this.model.decision?.error);
  }

  get isLegalFormChange() {
    return (
      this.model.changeEvent.type?.id === CHANGE_EVENT_TYPE.LEGAL_FORM_CHANGE
    );
  }

  /**
   * Whether the request is applied at once: ABB decides, so its own
   * registration needs no validation.
   */
  get appliesAtOnce() {
    return this.changeRequests.rights?.canDecide === true;
  }

  get submitLabel() {
    return this.appliesAtOnce ? 'Opslaan' : 'Aanvraag versturen';
  }

  /**
   * Choose the type of the event. A werkingsgebied or qualifications change
   * starts from the organisation's current values, so that the submitter
   * only changes what changed; switching types clears what the previous
   * type filled in.
   */
  @action
  async updateChangeEventType(type) {
    this.model.changeEvent.type = type;

    this.selectedResultingLegalForm = null;
    this.selectedResultingLocations = [];
    this.selectedResultingAdditionalQualifications = [];
    this.resultingName = null;
    this.currentLocationsInScope = null;

    if (type?.id === CHANGE_EVENT_TYPE.WERKINGSGEBIED_CHANGE) {
      let locations = null;
      try {
        locations = await this.scopeOfOperation.getLocationsInScope(
          this.model.organization,
        );
      } catch (error) {
        console.warn('The current werkingsgebied could not be loaded', error);
      }

      // Unless another type was chosen meanwhile. Without the locations (the
      // scope-of-operation service did not answer) the field starts empty.
      if (this.model.changeEvent.type === type && locations) {
        this.currentLocationsInScope = locations;
        this.selectedResultingLocations = locations;
      }
    } else if (type?.id === CHANGE_EVENT_TYPE.ADDITIONAL_QUALIFICATION_CHANGE) {
      this.selectedResultingAdditionalQualifications = (
        this.model.organization.additionalQualifications ?? []
      ).slice();
    }
  }

  @action
  updateResultingLegalForm(legalForm) {
    this.selectedResultingLegalForm = legalForm;
  }

  @action
  updateResultingLocations(locations) {
    this.selectedResultingLocations = locations;
  }

  @action
  updateResultingAdditionalQualifications(qualifications) {
    this.selectedResultingAdditionalQualifications = qualifications;
  }

  @action
  setReason(event) {
    this.reason = event.target.value;
  }

  submitRequestTask = dropTask(async (event) => {
    event.preventDefault();
    if (this.saveBlocked) {
      return;
    }
    this.saveError = null;

    const { organization, changeEvent, decision } = this.model;

    if (changeEvent.requiresDecisionInformation) {
      decision.documentLinks = decision.documentLinks.filter((link) =>
        link.trim(),
      );
    }

    await changeEvent.validate();
    if (changeEvent.requiresDecisionInformation) {
      await decision.validate();
    }
    if (this.isLegalFormChange && !this.selectedResultingLegalForm) {
      changeEvent.addError(
        'resultingLegalForm',
        'Selecteer een juridische vorm',
      );
    }
    if (
      changeEvent.isWerkingsgebiedChangeEvent &&
      this.selectedResultingLocations.length === 0
    ) {
      changeEvent.addError(
        'resultingScope',
        'Selecteer minstens één werkingsgebied',
      );
    }
    if (
      isAdditionalQualificationChangeEvent(changeEvent) &&
      this.selectedResultingAdditionalQualifications.length === 0
    ) {
      changeEvent.addError(
        'resultingAdditionalQualifications',
        'Selecteer een optie',
      );
    }
    if (isNameChangeType(changeEvent.type) && !this.resultingName) {
      changeEvent.addError('resultingName', 'Vul de nieuwe naam in');
    }

    // A new value that equals the organisation's current value changes
    // nothing: refused, so that no event is requested by accident
    if (
      isNameChangeType(changeEvent.type) &&
      this.resultingName &&
      this.resultingName.trim() === organization.abbName?.trim()
    ) {
      changeEvent.addError('resultingName', SAME_VALUE_ERROR_MESSAGE);
    }
    if (
      this.isLegalFormChange &&
      this.selectedResultingLegalForm &&
      this.selectedResultingLegalForm.id === (await organization.legalForm)?.id
    ) {
      changeEvent.addError('resultingLegalForm', SAME_VALUE_ERROR_MESSAGE);
    }
    if (
      changeEvent.isWerkingsgebiedChangeEvent &&
      this.selectedResultingLocations.length > 0 &&
      containsSameIds(
        this.selectedResultingLocations,
        this.currentLocationsInScope ?? [],
      )
    ) {
      changeEvent.addError('resultingScope', SAME_VALUE_ERROR_MESSAGE);
    }
    if (
      isAdditionalQualificationChangeEvent(changeEvent) &&
      this.selectedResultingAdditionalQualifications.length > 0 &&
      containsSameIds(
        this.selectedResultingAdditionalQualifications,
        organization.additionalQualifications ?? [],
      )
    ) {
      changeEvent.addError(
        'resultingAdditionalQualifications',
        SAME_VALUE_ERROR_MESSAGE,
      );
    }
    if (this.hasValidationErrors) {
      return;
    }

    // What the event results in
    let resultingStatus;
    let resultingScope = null;
    try {
      const resultingStatusId =
        RESULTING_STATUS_FOR_CHANGE_EVENT_TYPE[changeEvent.type.id] ??
        (await organization.organizationStatus)?.id;
      ({ content: resultingStatus } = await this.store.request(
        findRecord('organization-status-code', resultingStatusId),
      ));
      if (changeEvent.isWerkingsgebiedChangeEvent) {
        resultingScope = await this.scopeOfOperation.getScopeForLocations(
          ...this.selectedResultingLocations,
        );
      }
    } catch (error) {
      this.saveError =
        error.message ??
        'De gevolgen van de veranderingsgebeurtenis konden niet bepaald worden.';
      return;
    }
    const resultingLegalForm = this.isLegalFormChange
      ? this.selectedResultingLegalForm
      : null;
    const resultingAdditionalQualifications =
      isAdditionalQualificationChangeEvent(changeEvent)
        ? this.selectedResultingAdditionalQualifications
        : [];
    const resultingName = isNameChangeType(changeEvent.type)
      ? this.resultingName
      : null;

    // The organisation's current value of what the event changes, kept on
    // the result as its original value. Taken before the organisation
    // follows the event below; the type cannot change once the event is
    // recorded, so the other values need not be kept.
    const originalName = isNameChangeType(changeEvent.type)
      ? organization.abbName
      : null;
    const originalLegalForm = this.isLegalFormChange
      ? await organization.legalForm
      : null;
    const originalScope = changeEvent.isWerkingsgebiedChangeEvent
      ? await organization.scope
      : null;
    const originalAdditionalQualifications =
      isAdditionalQualificationChangeEvent(changeEvent)
        ? (organization.additionalQualifications ?? []).slice()
        : [];

    const changeEventResult = this.store.createRecord('change-event-result', {
      status: resultingStatus,
      resultingLegalForm,
      resultingScope,
      resultingAdditionalQualifications,
      resultingName,
      resultingOrganization: organization,
      resultFrom: changeEvent,
    });
    if (originalName) {
      changeEventResult.originalName = originalName;
    }
    if (originalLegalForm) {
      changeEventResult.originalLegalForm = originalLegalForm;
    }
    if (originalScope) {
      changeEventResult.originalScope = originalScope;
    }
    if (originalAdditionalQualifications.length > 0) {
      changeEventResult.originalAdditionalQualifications =
        originalAdditionalQualifications;
    }
    this.changeEventResult = changeEventResult;
    changeEvent.resultingOrganizations = [organization];

    // The organisation follows the event, unless a later event was recorded
    // already (an event entered after the fact)
    if (await isMostRecentChangeEvent(this.store, changeEvent, organization)) {
      organization.organizationStatus = resultingStatus;
      if (resultingLegalForm) {
        organization.legalForm = resultingLegalForm;
      }
      if (resultingScope) {
        organization.scope = resultingScope;
      }
      if (resultingAdditionalQualifications.length > 0) {
        organization.additionalQualifications =
          resultingAdditionalQualifications;
      }
      if (resultingName) {
        organization.setAbbName(resultingName);
      }
    }

    // The besluit, when the type asks for one and it was filled in; set on
    // every attempt, as the links may have been cleared since the last one
    const records = [];
    const withDecision =
      changeEvent.requiresDecisionInformation && !decision.isEmpty;
    changeEvent.decision = withDecision ? decision : null;
    if (withDecision) {
      records.push(decision);
    }
    records.push(changeEvent, changeEventResult, organization);

    let saved;
    try {
      saved = await this.changeRequests.submit(
        'change-event',
        organization.id,
        records,
        { reason: this.reason.trim() || null },
      );
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      if (error.applied) {
        // ABB's request is applied, but the page could not follow it up:
        // the overview loads the events as they are now
        this.toaster.warning(error.message, 'Wijziging doorgevoerd');
        this.router.replaceWith('organizations.organization.change-events');
        return;
      }
      if (error.applyFailed && error.requestId) {
        // ABB's request is kept, but applying it failed: the request page
        // shows why
        this.toaster.warning(error.message, 'Doorvoeren mislukt');
        this.router.replaceWith('aanvragen.aanvraag', error.requestId);
        return;
      }
      if (error.held && error.waiting && error.requestId) {
        // Recorded: the request waits; the organisation is unchanged
        if (this.appliesAtOnce) {
          // ABB's own request waits when data it changes was changed
          // meanwhile: ABB reviews the differences on the request page
          this.toaster.warning(
            'De veranderingsgebeurtenis is bewaard, maar nog niet doorgevoerd: intussen werden gegevens gewijzigd die ze ook wijzigt. Bekijk de verschillen en keur de aanvraag goed.',
            'Aanvraag wacht op goedkeuring',
          );
        } else {
          this.toaster.success(
            'De aanvraag is verstuurd en wordt gevalideerd door ABB. De gegevens van de organisatie veranderen na goedkeuring.',
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
      // Nothing is applied: the organisation goes back to what was loaded,
      // so that another attempt starts from it. When the outcome is unknown
      // only a reload tells whether one is needed.
      this.discardAttempt();
      this.saveError = error.outcomeUnknown
        ? OUTCOME_UNKNOWN_MESSAGE
        : error.message;
      this.saveBlocked = error.outcomeUnknown;
      return;
    }

    // ABB's request is applied at once: the event exists
    this.router.replaceWith(
      'organizations.organization.change-events.details',
      saved.get(changeEvent).id,
    );
  });

  /**
   * Undo what an attempt that was not applied did to the records of the
   * page, so that a new one starts from the organisation as it was loaded:
   * the result it created and the fields of the organisation the event
   * changed. Rolling back the organisation's relationships also takes it
   * out of the event's organisations (their inverse); the event is about it
   * all the same.
   */
  discardAttempt() {
    const { organization, changeEvent } = this.model;
    unloadNew(this.changeEventResult);
    this.changeEventResult = null;
    this.changeRequests.rollbackRelationships(organization);
    organization.rollbackAttributes();
    changeEvent.originalOrganizations = [organization];
  }

  reset() {
    const { organization, changeEvent, decision } = this.model;
    // The organisation keeps nothing of a request that was not applied
    if (isLoaded(organization)) {
      this.changeRequests.rollbackRelationships(organization);
      organization.rollbackAttributes();
    }
    for (const record of [changeEvent, decision, this.changeEventResult]) {
      unloadNew(record);
    }
    this.changeEventResult = null;
    this.selectedResultingLegalForm = null;
    this.selectedResultingLocations = [];
    this.selectedResultingAdditionalQualifications = [];
    this.resultingName = null;
    this.currentLocationsInScope = null;
    this.reason = '';
    this.saveError = null;
    this.saveBlocked = false;
  }
}

/**
 * Whether both lists hold records with exactly the same ids, in any order.
 */
function containsSameIds(a = [], b = []) {
  const idsA = a.map(({ id }) => id).sort();
  const idsB = b.map(({ id }) => id).sort();
  return (
    idsA.length === idsB.length && idsA.every((id, index) => id === idsB[index])
  );
}

/**
 * The message for an attempt whose outcome is unknown.
 */
const OUTCOME_UNKNOWN_MESSAGE =
  'Het is niet zeker of je aanvraag werd verwerkt. Herlaad de pagina en kijk onder "Alle aanvragen" of ze werd ontvangen voor je ze opnieuw verstuurt.';

/**
 * Drop a record the page created and nothing saved.
 */
function unloadNew(record) {
  if (isLoaded(record) && record.isNew) {
    record.deleteRecord();
    record.unloadRecord();
  }
}
