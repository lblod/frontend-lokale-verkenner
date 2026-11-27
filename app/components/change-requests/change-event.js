import Component from '@glimmer/component';
import { isOrganizationType } from 'frontend-organization-portal/constants/change-requests';
import DateFormat from 'frontend-organization-portal/helpers/date-format';
import {
  MergerTypeIdList,
  MultipleOrganizationTypeIdList,
} from 'frontend-organization-portal/models/change-event-type';

/**
 * The veranderingsgebeurtenis of a change request, as the organisation's
 * change-event page shows it: the event, its result and its besluit.
 *
 * Arguments:
 * - `@operations`: the operations of the request
 */
export default class ChangeRequestsChangeEventComponent extends Component {
  get changeEvent() {
    return this.operationOfType('change-events');
  }

  get targetKey() {
    const organization = this.operations.find((operation) =>
      isOrganizationType(operation.data?.type),
    );
    return keyOf(organization);
  }

  get result() {
    const results = this.operationsOfType('change-event-results');
    const eventKey = keyOf(this.changeEvent);
    const targetKey = this.targetKey;
    // A multi-organisation event has one result per organisation.
    const targetResult = targetKey
      ? results.find(
          (operation) =>
            keyOfRelationship(operation, 'resulting-organization') ===
            targetKey,
        )
      : null;
    return (
      targetResult ??
      results.find(
        (operation) => keyOfRelationship(operation, 'result-from') === eventKey,
      ) ??
      results[0]
    );
  }

  get decision() {
    const decisions = this.operationsOfType('decisions');
    const decisionKey = keyOfRelationship(this.changeEvent, 'decision');
    return (
      decisions.find((operation) => keyOf(operation) === decisionKey) ??
      decisions[0]
    );
  }

  get decisionActivity() {
    const activities = this.operationsOfType('decision-activities');
    const activityKey = keyOfRelationship(
      this.decision,
      'has-decision-activity',
    );
    return (
      activities.find((operation) => keyOf(operation) === activityKey) ??
      activities[0]
    );
  }

  get typeReference() {
    return this.changeEvent?.data?.relationships?.type?.data ?? null;
  }

  get typeId() {
    return this.typeReference?.id ?? null;
  }

  get isMultipleOrganizationEvent() {
    return MultipleOrganizationTypeIdList.includes(this.typeId);
  }

  get isMerger() {
    return MergerTypeIdList.includes(this.typeId);
  }

  get leftFields() {
    if (!this.changeEvent) {
      return [];
    }
    return [
      referenceField('Type veranderingsgebeurtenis', this.typeReference),
      textField('Beschrijving', this.eventAttributes.description),
      textField('Oude naam', this.resultAttributes['original-name']),
      textField('Nieuwe naam', this.resultAttributes['resulting-name']),
      linksField(
        'Links naar besluiten',
        this.decisionAttributes['document-links'],
      ),
      referenceField(
        'Oud werkingsgebied',
        this.resultRelationships['original-scope']?.data,
      ),
      referenceField(
        'Nieuw werkingsgebied',
        this.resultRelationships['resulting-scope']?.data,
      ),
      referencesField(
        'Oude bijkomende kwalificatie(s)',
        this.resultRelationships['original-additional-qualifications']?.data,
      ),
      referencesField(
        'Nieuwe bijkomende kwalificatie(s)',
        this.resultRelationships['resulting-additional-qualifications']?.data,
      ),
    ].filter(Boolean);
  }

  get rightFields() {
    if (!this.changeEvent) {
      return [];
    }
    return [
      textField(
        'Datum ministerieel besluit',
        formatDate(this.decisionActivityAttributes['end-date']),
      ),
      textField(
        'Datum besluit',
        formatDate(this.decisionAttributes['publication-date']),
      ),
      textField(
        'Datum veranderingsgebeurtenis',
        formatDate(this.eventAttributes.date),
      ),
      referenceField(
        'Oude juridische vorm',
        this.resultRelationships['original-legal-form']?.data,
      ),
      referenceField(
        'Nieuwe juridische vorm',
        this.resultRelationships['resulting-legal-form']?.data,
      ),
    ].filter(Boolean);
  }

  get originalOrganizations() {
    return (
      this.changeEvent?.data?.relationships?.['original-organizations']?.data ??
      []
    );
  }

  get resultingOrganizations() {
    return (
      this.changeEvent?.data?.relationships?.['resulting-organizations']
        ?.data ?? []
    );
  }

  get statusReference() {
    return this.resultRelationships.status?.data ?? null;
  }

  get eventAttributes() {
    return this.changeEvent?.data?.attributes ?? {};
  }

  get resultAttributes() {
    return this.result?.data?.attributes ?? {};
  }

  get resultRelationships() {
    return this.result?.data?.relationships ?? {};
  }

  get decisionAttributes() {
    return this.decision?.data?.attributes ?? {};
  }

  get decisionActivityAttributes() {
    return this.decisionActivity?.data?.attributes ?? {};
  }

  get operations() {
    return this.args.operations ?? [];
  }

  operationOfType(type) {
    return this.operations.find(
      (operation) => operation.data?.type === type && operation.op !== 'delete',
    );
  }

  operationsOfType(type) {
    return this.operations.filter(
      (operation) => operation.data?.type === type && operation.op !== 'delete',
    );
  }
}

function keyOf(operation) {
  return operation?.data?.id ?? operation?.data?.lid ?? null;
}

function keyOfRelationship(operation, key) {
  const reference = operation?.data?.relationships?.[key]?.data;
  return reference?.id ?? reference?.lid ?? null;
}

function formatDate(value) {
  return value ? DateFormat.compute([value]) : null;
}

function textField(label, value) {
  return value ? { label, kind: 'text', value } : null;
}

function referenceField(label, reference) {
  return reference ? { label, kind: 'reference', value: reference } : null;
}

function referencesField(label, references) {
  return Array.isArray(references) && references.length
    ? { label, kind: 'references', value: references }
    : null;
}

function linksField(label, links) {
  return Array.isArray(links) && links.length
    ? { label, kind: 'links', value: links }
    : null;
}
