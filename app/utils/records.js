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
