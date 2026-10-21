import { tracked } from '@glimmer/tracking';
import { assert } from '@ember/debug';
import { recordIdentifierFor } from '@warp-drive/core';
import Model from '@warp-drive/legacy/model';

/**
 * Ember Data Model with Joi-based Validation
 */
export default class AbstractValidationModel extends Model {
  @tracked _validationError;

  /**
   * Get the validation schema for the model. Should be overridden in subclasses.
   * @returns {object} - The Joi validation schema.
   */
  get validationSchema() {
    throw new Error('validationSchema should be overridden');
  }

  /**
   * Get the validation error for the model.
   * @returns {object} - The validation error.
   */
  get error() {
    return this._validationError;
  }

  /**
   * Validate the model using the validation schema.
   * @param {object} [options] - The options for validation.
   * @returns {Promise<boolean>} - Whether the model is valid.
   */
  async validate(options = {}) {
    this.#resetValidationErrors();
    const serializedModel = this.#serializeModel();

    try {
      await this.validationSchema.validateAsync(serializedModel, {
        abortEarly: false,
        allowUnknown: true,
        context: {
          changedAttributes: this.changedAttributes(),
          ...options,
        },
      });
    } catch (error) {
      this._validationError = error.details?.reduce((acc, err) => {
        acc[err.context.key] = err;
        return acc;
      }, {});

      return false;
    }

    return true;
  }

  #serializeModelWithDepthControl(model, maxDepth = 2) {
    if (!model || maxDepth < 0) {
      return undefined;
    }
    const entries = [...model.constructor.fields, ['id', 'attribute']].map(
      ([key, type]) => {
        if (type === 'attribute') {
          return [key, model[key]];
        } else if (type === 'belongsTo') {
          const belongsTo = model.belongsTo(key).value();
          return [
            key,
            this.#serializeModelWithDepthControl(belongsTo, maxDepth - 1),
          ];
        } else if (type === 'hasMany') {
          const hasMany = model.hasMany(key).value();
          if (!hasMany?.length) return [key, undefined];
          const values = hasMany.map((item) => {
            return item.toString();
          });
          return [key, values];
        } else {
          assert(`Unknown field type: ${type}`);
        }
      },
    );

    return Object.fromEntries(entries);
  }

  #serializeModel() {
    const serializedModel = this.#serializeModelWithDepthControl(this);
    // Remove id on the top level
    delete serializedModel.id;

    return serializedModel;
  }

  /**
   * Reset the model to its original state: its attributes and, for a record
   * the backend has, its relationships. `rollbackAttributes` covers the
   * attributes only, so a relationship a cancelled page changed (a
   * juridische vorm, a theme) would stay changed in the store, and the next
   * change request about the record would carry it. A new record is
   * unloaded by `rollbackAttributes`.
   * @returns {void}
   * @see https://guides.emberjs.com/release/models/#toc_rolling-back-attributes
   */
  reset() {
    this.#resetValidationErrors();
    if (!this.isNew) {
      this.store.cache.rollbackRelationships(recordIdentifierFor(this));
    }
    this.rollbackAttributes();
  }

  resetErrors() {
    this.#resetValidationErrors();
  }

  removeError(propName) {
    if (!this._validationError?.[propName]) return;

    const errors = { ...this._validationError };
    delete errors[propName];
    this._validationError = Object.keys(errors).length ? errors : undefined;
  }

  addError(propName, errorMessage) {
    this._validationError = {
      ...this._validationError,
      [propName]: { message: errorMessage },
    };
  }

  #resetValidationErrors() {
    this._validationError = undefined;
  }
}
