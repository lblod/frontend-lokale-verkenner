import { getOwner } from '@ember/owner';
import { JSONAPIAdapter } from '@warp-drive/legacy/adapter/json-api';

export default class ApplicationAdapter extends JSONAPIAdapter {
  /**
   * Load a relationship through its link, and tell the serializer of the
   * record that its value is loaded now: a change request carries that
   * value as the base of a change (see `relationshipLoaded` of the
   * application serializer).
   */
  async findBelongsTo(store, snapshot, url, relationship) {
    const payload = await super.findBelongsTo(...arguments);
    this.noteFetched(snapshot, relationship);
    return payload;
  }

  /**
   * See `findBelongsTo`.
   */
  async findHasMany(store, snapshot, url, relationship) {
    const payload = await super.findHasMany(...arguments);
    this.noteFetched(snapshot, relationship);
    return payload;
  }

  /**
   * The serializer of the record is the one of its model when it has one,
   * else the application's, as the store picks it.
   */
  noteFetched(snapshot, relationship) {
    const owner = getOwner(this);
    const serializer =
      owner.lookup(`serializer:${snapshot.modelName}`) ??
      owner.lookup('serializer:application');
    serializer.relationshipFetched?.(
      snapshot.modelName,
      snapshot.id,
      relationship.name,
    );
  }
}
