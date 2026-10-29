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

  /**
   * Per record (`modelName:id`), by relationship name, whether the backend
   * sent the value of the relationship (`loaded`), or only a link to it and
   * never its value since (`linked`). See `relationshipLoaded`.
   */
  #relationshipLoads = new Map();

  serializeAttribute(snapshot, json, key, attributes) {
    if (key !== 'uri')
      super.serializeAttribute(snapshot, json, key, attributes);
  }

  normalize(modelClass, resourceHash) {
    const normalized = super.normalize(modelClass, resourceHash);
    this.#keepLoadedForms(modelClass, resourceHash, normalized.data);
    this.#keepRelationshipLoads(modelClass, resourceHash, normalized.data);
    return normalized;
  }

  /**
   * Whether the value of a relationship of a record was loaded from the
   * backend. False only for a relationship the backend sent as a link
   * (mu-cl-resources sends the value of an included relationship only) and
   * that was not loaded since, neither in another document of the record
   * nor through the link (`relationshipFetched`): the store reads such a
   * relationship as empty, so a change request that changes it would start
   * from a value the server does not have. True for a record this
   * serializer did not load: one the page created.
   *
   * @param {string} modelName
   * @param {string} id
   * @param {string} name - the relationship's name on the model
   * @returns {boolean}
   */
  relationshipLoaded(modelName, id, name) {
    const loads = this.#relationshipLoads.get(`${modelName}:${id}`);
    return loads?.get(name) !== 'linked';
  }

  /**
   * Note that the value of a relationship of a record was loaded through its
   * link, as the application adapter does once it followed one.
   *
   * @param {string} modelName
   * @param {string} id
   * @param {string} name - the relationship's name on the model
   */
  relationshipFetched(modelName, id, name) {
    this.#relationshipLoadsOf(`${modelName}:${id}`).set(name, 'loaded');
  }

  #keepRelationshipLoads(modelClass, resourceHash, data) {
    if (!data?.id || !resourceHash.relationships) {
      return;
    }
    const loads = this.#relationshipLoadsOf(`${data.type}:${data.id}`);
    modelClass.eachRelationship((name, descriptor) => {
      const payload =
        resourceHash.relationships[
          this.keyForRelationship(name, descriptor.kind, 'deserialize')
        ];
      if (payload?.data !== undefined) {
        loads.set(name, 'loaded');
      } else if (payload && loads.get(name) !== 'loaded') {
        // A link only: the store keeps the value it loaded before, if any
        loads.set(name, 'linked');
      }
    });
  }

  #relationshipLoadsOf(key) {
    let loads = this.#relationshipLoads.get(key);
    if (!loads) {
      loads = new Map();
      this.#relationshipLoads.set(key, loads);
    }
    return loads;
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
