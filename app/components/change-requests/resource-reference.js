import Component from '@glimmer/component';
import { service } from '@ember/service';
import { task } from 'ember-concurrency';
import { singularize } from '@warp-drive/utilities/string';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import {
  isOrganizationType,
  resourceLabel,
} from 'frontend-organization-portal/constants/change-requests';

/**
 * A record a change request points at, by name: a `{ type, id }` identifier
 * of the change-request API shown as the name or label of the record. A
 * record the same request creates has no name in the backend yet (or none
 * that the request proposes), so its name comes from the request's own
 * operations; any other record is loaded from the backend. An organisation
 * that exists links to its page.
 *
 * Arguments:
 * - `@reference`: `{ type, id }`, as the operations and conflicts carry them
 * - `@operations`: the operations of the request, to name the records it
 *   creates
 */
export default class ChangeRequestsResourceReferenceComponent extends Component {
  @service store;

  constructor() {
    super(...arguments);
    if (!this.ownOperation) {
      this.load.perform();
    }
  }

  /**
   * The operation of the same request on the referenced record, if any.
   */
  get ownOperation() {
    const { reference, operations } = this.args;
    return (operations ?? []).find(
      (operation) => operation?.data?.id === reference?.id,
    );
  }

  get label() {
    const { reference } = this.args;
    const own = this.ownOperation;
    if (own) {
      return (
        nameFromOperation(own, this.args.operations) ??
        resourceLabel(reference.type)
      );
    }
    const record = this.load.lastSuccessful?.value;
    return record ? nameOfRecord(record) : reference?.id;
  }

  /**
   * The route of the record's page: organisations that exist have one.
   */
  get route() {
    const { reference } = this.args;
    return isOrganizationType(reference?.type) &&
      !this.ownOperation &&
      this.load.lastSuccessful?.value
      ? 'organizations.organization'
      : null;
  }

  load = task(async () => {
    const { reference } = this.args;
    if (!reference?.type || !reference?.id) {
      return null;
    }
    try {
      const { content } = await this.store.request(
        findRecord(modelNameFor(reference.type), reference.id),
      );
      return content;
    } catch {
      // Unknown to the backend (or no model for it): the id is shown
      return null;
    }
  });
}

/**
 * The Ember Data model name of a JSON:API type of the change-request API.
 * The organisation subtypes load as the polymorphic organisation.
 */
export function modelNameFor(type) {
  return isOrganizationType(type) ? 'organization' : singularize(type);
}

/**
 * What a record of the application is called.
 */
export function nameOfRecord(record) {
  return (
    record.label ??
    record.abbName ??
    record.name ??
    record.fullAddress ??
    record.siteTypeName ??
    record.id
  );
}

/**
 * What a record a request creates is called, from the attributes its
 * operation proposes; an identifier is named with its number, which the
 * request proposes on the structured identifier it links to.
 */
export function nameFromOperation(operation, operations = []) {
  const { type, attributes = {}, relationships = {} } = operation.data;
  if (isOrganizationType(type)) {
    return attributes.name ?? attributes['legal-name'] ?? null;
  }
  switch (type) {
    case 'sites':
      return attributes['site-type-name'] ?? null;
    case 'addresses':
      return attributes['full-address'] ?? null;
    case 'identifiers': {
      const structuredId = relationships['structured-identifier']?.data?.id;
      const structured = operations.find(
        (other) => other?.data?.id === structuredId,
      );
      const number = structured?.data?.attributes?.['local-id'];
      return [attributes['id-name'], number].filter(Boolean).join(' ') || null;
    }
    case 'structured-identifiers':
      return attributes['local-id'] ?? null;
    case 'contact-points':
      return attributes.email ?? attributes.telephone ?? null;
    case 'change-events':
      return attributes.description ?? null;
    case 'decisions':
      return (
        attributes['document-links']?.join(', ') ??
        attributes['document-link'] ??
        null
      );
    default:
      return null;
  }
}
