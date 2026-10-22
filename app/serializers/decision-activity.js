import ApplicationSerializer from './application';

/**
 * A decision activity points at the decisions it gives cause to
 * (`givesCauseTo`, a one-to-many relationship, which the JSON:API serializer
 * leaves out by default), and the backend stores the link on the activity
 * (`prov:generated`; the decision's `has-decision-activity` is its inverse),
 * so the change-request service needs it there: the inverse side of a
 * relationship is not written. As for the results of a change event.
 */
export default class DecisionActivitySerializer extends ApplicationSerializer {
  attrs = {
    givesCauseTo: { serialize: true },
  };
}
