import Component from '@glimmer/component';
import {
  OPERATION_LABELS,
  fieldLabel,
  fieldRank,
  isOrganizationType,
  resourceLabel,
} from 'frontend-organization-portal/constants/change-requests';

const OPERATION_SKINS = {
  create: 'success',
  update: 'warning',
  delete: 'error',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

/**
 * The form of a change request as it was submitted: the operations the
 * service rebuilt from the stored versions (`GET /change-requests/:id`),
 * one card per record with the fields the request proposes for it.
 *
 * Arguments:
 * - `@operations`: `[{ op, data: { type, id, attributes, relationships } }]`
 */
export default class ChangeRequestsOperationsComponent extends Component {
  get items() {
    return (this.args.operations ?? []).map((operation) => {
      const { type, attributes = {}, relationships = {} } = operation.data;
      return {
        type,
        typeLabel: resourceLabel(type),
        opLabel: OPERATION_LABELS[operation.op] ?? operation.op,
        opSkin: OPERATION_SKINS[operation.op] ?? 'default',
        fields: [
          ...Object.entries(attributes).map(([key, value]) => ({
            key,
            rank: fieldRank(type, key),
            label: fieldLabel(type, key),
            ...attributeField(key, value, type),
          })),
          ...Object.entries(relationships).map(([key, value]) => ({
            key,
            rank: fieldRank(type, key),
            label: fieldLabel(type, key),
            ...relationshipField(value?.data),
          })),
        ].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key)),
      };
    });
  }
}

/**
 * How an attribute value is shown: `kind` is `text`, `date`, `list`,
 * `rich-text` (the Doel of an organisation, which the rich-text editor
 * writes as HTML; shown cleaned, see `sanitizeRichText`) or `empty`.
 */
export function attributeField(key, value, type) {
  if (value === null || value === undefined || value === '') {
    return { kind: 'empty', value: null };
  }
  if (key === 'purpose' && isOrganizationType(type)) {
    return { kind: 'rich-text', value: String(value) };
  }
  if (Array.isArray(value)) {
    return { kind: 'list', value: value.map(String) };
  }
  if (typeof value === 'boolean') {
    return { kind: 'text', value: value ? 'Ja' : 'Nee' };
  }
  if (typeof value === 'string' && DATE_PATTERN.test(value)) {
    return { kind: 'date', value };
  }
  return { kind: 'text', value: String(value) };
}

/**
 * How a relationship value is shown: one reference, a list of them, or
 * nothing.
 */
export function relationshipField(data) {
  if (Array.isArray(data)) {
    return { kind: 'references', value: data };
  }
  if (data && typeof data === 'object') {
    return { kind: 'reference', value: data };
  }
  return { kind: 'empty', value: null };
}
