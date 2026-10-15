import Component from '@glimmer/component';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

/**
 * The notice of a save the change-request service held for a decision by ABB
 * (`ChangeRequestError.held`): which fields someone else changed meanwhile,
 * that the request waits for ABB, and that saving the same fields again
 * replaces it (the service then withdraws it; saving only part of them leaves
 * it waiting next to the new change), with a button to withdraw it.
 *
 * Arguments:
 * - `@held`: null, or `{ id, fields, reloadFailed }`: the uuid of the held
 *   request (null when the service did not give it, then it cannot be
 *   withdrawn here), the labels of the fields in conflict, and whether the
 *   records could not be reloaded afterwards, in which case the notice asks
 *   for a reload instead of showing its block.
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
    return Boolean(this.args.held?.id) && !this.withdrawn;
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
