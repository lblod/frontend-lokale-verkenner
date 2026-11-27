import Component from '@glimmer/component';
import DateFormat from 'frontend-organization-portal/helpers/date-format';
import {
  fieldLabel,
  fieldRank,
  isOrganizationType,
} from 'frontend-organization-portal/constants/change-requests';

/**
 * The form of a change request as the design shows it: "Organisatie" with
 * what the request changes on the organisation, and "Primaire contact
 * gegevens" with the address and contact details it submits.
 *
 * Arguments:
 * - `@operations`: `[{ op, data: { type, id, attributes, relationships } }]`
 */
/** The site records have their own card; they are not fields of the organisation. */
const NOT_ORGANISATION_FIELDS = ['primary-site', 'sites'];

export default class ChangeRequestsRequestFormComponent extends Component {
  get organization() {
    return this.fieldsOf((type) => isOrganizationType(type));
  }

  get organizationColumns() {
    const fields = this.organization;
    const half = Math.ceil(fields.length / 2);
    return { left: fields.slice(0, half), right: fields.slice(half) };
  }

  get address() {
    return this.fieldsOf((type) => type === 'addresses');
  }

  /**
   * The contact details of every contact the request submits, labelled as
   * the organisation page labels them: primary or secondary telephone,
   * e-mail and website.
   */
  get contacts() {
    return (this.args.operations ?? [])
      .filter(
        ({ op, data }) => data.type === 'contact-points' && op !== 'delete',
      )
      .flatMap(({ data }) => contactFields(data.attributes ?? {}));
  }

  /**
   * The fields of the first operation of a matching type, in the order the
   * labels give. A field the request clears (null) is left out: this page
   * shows the organisation as the request proposes it, not a diff.
   */
  fieldsOf(matches) {
    const operation = (this.args.operations ?? []).find(
      ({ op, data }) => matches(data.type) && op !== 'delete',
    );
    if (!operation) {
      return [];
    }
    const { type, attributes = {}, relationships = {} } = operation.data;
    return [
      ...Object.entries(attributes).map(([key, value]) => ({
        key,
        label: fieldLabel(type, key),
        kind:
          key === 'purpose' && isOrganizationType(type) ? 'rich-text' : 'text',
        value: displayValue(value),
      })),
      ...Object.entries(relationships)
        .filter(([key]) => !NOT_ORGANISATION_FIELDS.includes(key))
        .map(([key, value]) => ({
          key,
          label: fieldLabel(type, key),
          kind: Array.isArray(value?.data) ? 'references' : 'reference',
          value: value?.data ?? null,
        })),
    ]
      .filter(isPresent)
      .sort((a, b) => fieldRank(type, a.key) - fieldRank(type, b.key));
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

/**
 * A value as text, or '' for a value the page cannot show: a cleared field,
 * or a relationship, which comes as a reference (`{ type, id }`) whose label
 * this page does not have.
 */
function displayValue(value) {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(displayValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nee';
  }
  if (typeof value === 'object') {
    return '';
  }
  if (DATE_PATTERN.test(value)) {
    return DateFormat.compute([value]);
  }
  return String(value);
}

function isPresent(field) {
  if (field.kind === 'text' || field.kind === 'rich-text') {
    return field.value !== '';
  }
  if (field.kind === 'references') {
    return field.value.length > 0;
  }
  return Boolean(field.value?.id);
}

function contactFields(attributes) {
  const primary = attributes.type !== 'Secondary';
  const fields = [];
  if (attributes.telephone) {
    fields.push({
      key: 'telephone',
      label: primary ? 'Primair telefoonnummer' : 'Secundair telefoonnummer',
      kind: 'tel',
      value: attributes.telephone,
    });
  }
  if (attributes.email) {
    fields.push({
      key: 'email',
      label: 'E-mail',
      kind: 'text',
      value: attributes.email,
    });
  }
  if (attributes.website) {
    fields.push({
      key: 'website',
      label: 'Website',
      kind: 'link',
      value: attributes.website,
    });
  }
  return fields;
}
