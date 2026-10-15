import { JSONAPISerializer } from '@warp-drive/legacy/serializer/json-api';
// eslint-disable-next-line ember/no-mixins
import DataTableSerializerMixin from 'frontend-organization-portal/mixins/ember-data-table/serializer';

/**
 * The transforms whose `serialize` does not always write a value in the form
 * the backend sent it: `phone` reads "tel:+32…" and a number stored without
 * the prefix alike, always writes "tel:", and writes "" as null.
 */
const LOSSY_TRANSFORMS = new Set(['phone']);

export default class ApplicationSerializer extends JSONAPISerializer.extend(
  DataTableSerializerMixin,
) {
  /**
   * Per record (`modelName:id`), by attribute name, the values of a lossy
   * transform that the backend sent in another form than `serialize` writes
   * them: `{ loaded, value }`, the value as sent and as read. See
   * `loadedForm`.
   */
  #loadedForms = new Map();

  serializeAttribute(snapshot, json, key, attributes) {
    if (key !== 'uri')
      super.serializeAttribute(snapshot, json, key, attributes);
  }

  normalize(modelClass, resourceHash) {
    const normalized = super.normalize(modelClass, resourceHash);
    this.#keepLoadedForms(modelClass, resourceHash, normalized.data);
    return normalized;
  }

  /**
   * The value of an attribute in the form the backend sent it, when `value`
   * is what the record read from it and the attribute's transform would
   * write it in another form, as it does for a telephone number stored
   * without "tel:" or as "". Undefined otherwise: the transform writes the
   * stored form, or the record was not loaded through this serializer.
   *
   * The change-request service compares the base of a key with the stored
   * value in its exact form, so the base of such a value must be the form
   * that is stored.
   *
   * @param {string} modelName
   * @param {string} id
   * @param {string} name - the attribute's name on the model
   * @param {*} value - the value the record had when it was loaded
   * @returns {*}
   */
  loadedForm(modelName, id, name, value) {
    const kept = this.#loadedForms.get(`${modelName}:${id}`)?.get(name);
    return kept && kept.value === value ? kept.loaded : undefined;
  }

  #keepLoadedForms(modelClass, resourceHash, data) {
    if (!data?.id || !resourceHash.attributes) {
      return;
    }
    const key = `${data.type}:${data.id}`;
    const forms = new Map(this.#loadedForms.get(key));

    modelClass.eachTransformedAttribute((name, type) => {
      const loaded =
        resourceHash.attributes[this.keyForAttribute(name, 'deserialize')];
      if (!LOSSY_TRANSFORMS.has(type) || loaded === undefined) {
        return;
      }
      const value = data.attributes[name];
      if (this.transformFor(type).serialize(value) === loaded) {
        forms.delete(name);
      } else {
        forms.set(name, { loaded, value });
      }
    });

    if (forms.size > 0) {
      this.#loadedForms.set(key, forms);
    } else {
      this.#loadedForms.delete(key);
    }
  }
}
