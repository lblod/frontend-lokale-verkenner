import Component from '@glimmer/component';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

/**
 * The notice of a save the change-request service did not apply
 * (`ChangeRequestError.held`): which fields someone else changed meanwhile
 * and, for a request that waits for ABB, that it waits and that saving the
 * same fields again replaces it (the service then withdraws it; saving only
 * part of them leaves it waiting next to the new change), with a button to
 * withdraw it. A stale edit the service refused waits for no one: the user
 * enters the change again.
 *
 * Arguments:
 * - `@held`: null, or `{ id, fields, reloadFailed, waiting }`: the uuid of
 *   the request that waits (null when the service did not give it, or when
 *   none waits; then it cannot be withdrawn here), the labels of the fields
 *   in conflict, whether the records could not be reloaded afterwards, in
 *   which case the notice asks for a reload instead of showing its block,
 *   and whether a request waits for ABB.
 * - block: what the page did with its form, e.g. that it shows the stored
 *   values again.
 */
export default class ErrorChangeRequestHeldComponent extends Component {
  @service changeRequests;

  /**
   * The id of the request this notice withdrew, and `{ id, message }` for a
   * withdrawal that failed. Kept per request: a later save gives the page a
   * new `@held`, whose request is not withdrawn.
   */
  @tracked withdrawnId = null;
  @tracked failure = null;

  get canWithdraw() {
    const { held } = this.args;
    return Boolean(held?.waiting && held?.id) && !this.withdrawn;
  }

  get withdrawn() {
    return (
      Boolean(this.args.held?.id) && this.withdrawnId === this.args.held.id
    );
  }

  get withdrawError() {
    const { failure } = this;
    return failure && failure.id === this.args.held?.id
      ? failure.message
      : null;
  }

  withdraw = dropTask(async () => {
    const { id } = this.args.held;
    this.failure = null;
    try {
      await this.changeRequests.withdraw(id);
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      this.failure = { id, message: error.message };
      return;
    }
    this.withdrawnId = id;
  });
}
