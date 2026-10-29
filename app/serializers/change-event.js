import ApplicationSerializer from './application';

/**
 * A change event carries its results in a change request. The results point
 * back at the event (`resultFrom`, a many-to-one relationship, which the
 * JSON:API serializer leaves out of the event by default), but the backend
 * stores the link on the event (`code:veranderingsgebeurtenisResultaat`), so
 * the change-request service needs it there: the inverse side of a
 * relationship is not written.
 */
export default class ChangeEventSerializer extends ApplicationSerializer {
  attrs = {
    results: { serialize: true },
  };
}
