import Controller from '@ember/controller';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { dropTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import {
  findRecord,
  query as queryBuilder,
} from '@warp-drive/legacy/compat/builders';
import {
  CHANGE_EVENT_TYPE,
  MultipleOrganizationTypeIdList,
  isNameChangeType,
} from 'frontend-organization-portal/models/change-event-type';
import { ORGANIZATION_STATUS } from 'frontend-organization-portal/models/organization-status-code';
import isAdditionalQualificationChangeEvent from 'frontend-organization-portal/helpers/is-additional-qualification-change-event';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
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

/**
 * The form that requests a veranderingsgebeurtenis about one organisation:
 * the change event with its besluit, its result (the resulting status, legal
 * form, werkingsgebied, qualifications or name) and the fields of the
 * organisation the event changes, submitted as one change request
 * (aggregate `change-event`). The event is recorded and the organisation
 * changed when ABB approves; ABB's own request is applied at once.
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

  @action
  setType(type) {
    this.model.changeEvent.type = type;
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

    const changeEventResult = this.store.createRecord('change-event-result', {
      status: resultingStatus,
      resultingLegalForm,
      resultingScope,
      resultingAdditionalQualifications,
      resultingName,
      resultingOrganization: organization,
      resultFrom: changeEvent,
    });
    (await changeEvent.resultingOrganizations).push(organization);

    // The organisation follows the event, unless a later event was recorded
    // already (an event entered after the fact)
    if (await this.isMostRecent(changeEvent, organization)) {
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

    const records = [];
    if (changeEvent.requiresDecisionInformation && !decision.isEmpty) {
      changeEvent.decision = decision;
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
      if (error.held && error.waiting && error.requestId) {
        // Recorded: the request waits for ABB; the organisation is unchanged
        this.toaster.success(
          'De aanvraag is verstuurd en wordt gevalideerd door ABB. De gegevens van de organisatie veranderen na goedkeuring.',
          'Aanvraag verstuurd',
        );
        this.router.replaceWith('aanvragen.aanvraag', error.requestId);
        return;
      }
      this.saveError = error.message;
      return;
    }

    // ABB's request is applied at once: the event exists
    this.router.replaceWith(
      'organizations.organization.change-events.details',
      saved.get(changeEvent).id,
    );
  });

  /**
   * Whether no later change event of the organisation is recorded yet, so
   * the event is the one the organisation's current fields follow.
   */
  async isMostRecent(changeEvent, organization) {
    const { content: results } = await this.store.request(
      queryBuilder('change-event-result', {
        'filter[resulting-organization][:id:]': organization.id,
        include: 'result-from',
        page: { size: 1 },
        sort: '-result-from.date',
      }),
    );
    const mostRecent = results.length ? await results.at(0).resultFrom : null;
    return (
      !mostRecent || !mostRecent.date || mostRecent.date <= changeEvent.date
    );
  }

  reset() {
    const { organization, changeEvent, decision } = this.model;
    // The organisation keeps nothing of a request that was not applied
    if (isLoaded(organization)) {
      this.changeRequests.rollbackRelationships(organization);
      organization.rollbackAttributes();
    }
    for (const record of [changeEvent, decision]) {
      if (isLoaded(record) && record.isNew) {
        record.deleteRecord();
        record.unloadRecord();
      }
    }
    this.selectedResultingLegalForm = null;
    this.selectedResultingLocations = [];
    this.selectedResultingAdditionalQualifications = [];
    this.resultingName = null;
    this.reason = '';
    this.saveError = null;
  }
}
