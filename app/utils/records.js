/**
 * Whether a record can still be used. False once it is unloaded, as happens
 * to a new record after the change request that created it was applied: the
 * page then has the fresh record under the uuid the backend minted, but its
 * model may still hold the old one.
 *
 * @param {Object} record Ember data model
 * @returns {boolean}
 */
export function isLoaded(record) {
  return Boolean(record) && !record.isDestroyed && !record.isDestroying;
}

/**
 * Whether the user entered something in a record of the page. For a
 * persisted record that is a changed attribute. A new record is always dirty
 * (`hasDirtyAttributes`), also a placeholder the page created for a missing
 * one (a contact point, an identifier) that the user left empty; for a new
 * record it is an attribute with a value, other than the ones the page set
 * when it created the record (the `type` of a contact point, the `idName` of
 * an identifier). A placeholder the user left empty is neither submitted nor
 * linked, so that a save does not change a list nobody edited.
 *
 * @param {Object} record Ember data model
 * @param {string[]} [presetAttributes] - the attributes the page set on a
 *     new record
 * @returns {boolean}
 */
export function hasUserInput(record, presetAttributes = []) {
  if (!record.isNew) {
    return record.hasDirtyAttributes;
  }

  return Object.entries(record.changedAttributes()).some(
    ([name, [, value]]) =>
      !presetAttributes.includes(name) &&
      value !== null &&
      value !== undefined &&
      value !== '',
  );
}
