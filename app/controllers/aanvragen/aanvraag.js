import Controller from '@ember/controller';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import {
  KIND,
  KIND_LABELS,
  PENDING_STATUSES,
  STATUS,
  STATUS_DESCRIPTIONS,
  STEP,
} from 'frontend-organization-portal/constants/change-requests';

/**
 * One change request: what the session may do with it and the modal that
 * takes the step. Which actions show follows the status of the request and
 * who looks at it: ABB decides (goedkeuring, afkeuring, informatievraag),
 * the requesting organisation answers a question, contests a rejection and
 * withdraws its request. An edit, which applies at once, takes none of the
 * decision steps: a failed one is withdrawn. Applying a failed request again
 * (a hertoepassing) is not in the designs, so the page does not offer it;
 * the service still takes that step through its API. The service checks the
 * same rules on every step. When the request could not be loaded, the model
 * holds the `error` and the page shows its message.
 */
export default class AanvragenAanvraagController extends Controller {
  @service currentSession;
  @service router;
  @service toaster;

  /**
   * The step type whose modal is open, or null.
   */
  @tracked openStep = null;

  get request() {
    return this.model.request ?? null;
  }

  get attributes() {
    return this.request?.attributes ?? {};
  }

  get title() {
    return KIND_LABELS[this.attributes.kind] ?? 'Aanvraag';
  }

  /**
   * Whether the request is an edit, applied at once without a decision.
   */
  get isEdit() {
    return this.attributes.kind === KIND.EDIT;
  }

  get status() {
    return this.attributes.status;
  }

  get statusDescription() {
    return STATUS_DESCRIPTIONS[this.status] ?? '';
  }

  get isPending() {
    return PENDING_STATUSES.includes(this.status);
  }

  get steps() {
    return this.attributes.steps ?? [];
  }

  get lastStep() {
    return this.steps.at(-1) ?? null;
  }

  /**
   * Whether the session acts for the organisation that submitted the
   * request.
   */
  get isRequester() {
    return (
      Boolean(this.model.requesterId) &&
      this.model.requesterId === this.currentSession.organizationId
    );
  }

  get decides() {
    return this.model.rights?.canDecide === true;
  }

  get canApprove() {
    return this.decides && !this.isEdit && this.status === STATUS.SUBMITTED;
  }

  get canReject() {
    return (
      this.decides &&
      !this.isEdit &&
      [STATUS.SUBMITTED, STATUS.INFORMATION_REQUESTED, STATUS.FAILED].includes(
        this.status,
      )
    );
  }

  get canAskInformation() {
    return this.decides && !this.isEdit && this.status === STATUS.SUBMITTED;
  }

  get canAnswer() {
    return (
      this.isRequester &&
      !this.isEdit &&
      this.status === STATUS.INFORMATION_REQUESTED
    );
  }

  get canContest() {
    return this.isRequester && !this.isEdit && this.status === STATUS.REJECTED;
  }

  get canWithdraw() {
    return (
      (this.isRequester || this.decides) &&
      [STATUS.SUBMITTED, STATUS.INFORMATION_REQUESTED, STATUS.FAILED].includes(
        this.status,
      )
    );
  }

  get hasActions() {
    return (
      this.canApprove ||
      this.canReject ||
      this.canAskInformation ||
      this.canAnswer ||
      this.canContest ||
      this.canWithdraw
    );
  }

  /**
   * The open question of ABB, while the requester has not answered.
   */
  get openQuestion() {
    return this.status === STATUS.INFORMATION_REQUESTED
      ? this.lastStepOfType(STEP.INFORMATION_REQUEST)
      : null;
  }

  /**
   * The requester's answer that brought the request back into validation.
   */
  get freshAnswer() {
    return this.status === STATUS.SUBMITTED &&
      this.lastStep?.type === STEP.INFORMATION_ANSWER
      ? this.lastStep
      : null;
  }

  /**
   * The requester's contest that brought the request back into validation.
   */
  get freshContest() {
    return this.status === STATUS.SUBMITTED &&
      this.lastStep?.type === STEP.CONTEST
      ? this.lastStep
      : null;
  }

  /**
   * The rejection, while the request is rejected.
   */
  get rejection() {
    return this.status === STATUS.REJECTED
      ? this.lastStepOfType(STEP.REJECTION)
      : null;
  }

  get conflicts() {
    return this.attributes.conflicts ?? [];
  }

  lastStepOfType(type) {
    return [...this.steps].reverse().find((step) => step.type === type) ?? null;
  }

  @action
  open(step) {
    this.openStep = step;
  }

  @action
  close() {
    this.openStep = null;
  }

  /**
   * The step is taken: show the updated request.
   */
  @action
  async stepTaken(document, message) {
    this.openStep = null;
    this.toaster.success(message, 'Aanvraag');
    await this.router.refresh('aanvragen.aanvraag');
  }

  /**
   * A goedkeuring was taken, but applying the request failed: the request is
   * kept with status `mislukt`, so the page shows it anew, with the steps
   * that status admits.
   */
  @action
  async applyFailed(message) {
    this.openStep = null;
    this.toaster.error(message, 'Doorvoeren mislukt');
    await this.router.refresh('aanvragen.aanvraag');
  }

  reset() {
    this.openStep = null;
  }
}
