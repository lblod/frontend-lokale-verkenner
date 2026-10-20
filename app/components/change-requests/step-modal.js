import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import {
  STEP,
  fieldLabel,
} from 'frontend-organization-portal/constants/change-requests';

/**
 * What each step asks of the user, as the designs word it.
 */
const STEPS = {
  [STEP.APPROVAL]: {
    title: 'Aanvraag goedkeuren',
    intro:
      'De gegevens van de aanvraag worden doorgevoerd in het register. De aanvrager krijgt hiervan een melding.',
    textLabel: null,
    confirmLabel: 'Goedkeuren',
    loadingLabel: 'Aanvraag goedkeuren',
    alert: false,
    done: 'De aanvraag is goedgekeurd en doorgevoerd.',
  },
  [STEP.REJECTION]: {
    title: 'Aanvraag afkeuren',
    intro:
      'De aanvrager krijgt hiervan een melding, met de reden. De aanvrager kan de beslissing betwisten.',
    textLabel: 'Reden van afkeuring',
    textError: 'Geef de reden van de afkeuring.',
    confirmLabel: 'Afkeuren',
    loadingLabel: 'Aanvraag afkeuren',
    alert: true,
    done: 'De aanvraag is afgekeurd.',
  },
  [STEP.INFORMATION_REQUEST]: {
    title: 'Meer informatie opvragen',
    intro:
      'De aanvrager krijgt je vraag te zien en kan ze beantwoorden. De aanvraag wacht intussen.',
    textLabel: 'Welke informatie heb je nodig?',
    textError: 'Formuleer je vraag.',
    confirmLabel: 'Informatie opvragen',
    loadingLabel: 'Vraag versturen',
    alert: false,
    done: 'Je vraag is verstuurd naar de aanvrager.',
  },
  [STEP.INFORMATION_ANSWER]: {
    title: 'Beantwoord de aanvullende vraag',
    intro: 'Je antwoord gaat naar ABB; de aanvraag wordt opnieuw gevalideerd.',
    textLabel: 'Je antwoord',
    textError: 'Vul je antwoord in.',
    confirmLabel: 'Antwoord versturen',
    loadingLabel: 'Antwoord versturen',
    alert: false,
    done: 'Je antwoord is verstuurd. De aanvraag wordt opnieuw gevalideerd.',
  },
  [STEP.CONTEST]: {
    title: 'Beslissing betwisten',
    intro:
      'Leg uit waarom je niet akkoord gaat met de afkeuring. ABB bekijkt de aanvraag opnieuw.',
    textLabel: 'Waarom betwist je de beslissing?',
    textError: 'Leg uit waarom je de beslissing betwist.',
    confirmLabel: 'Betwisten',
    loadingLabel: 'Betwisting versturen',
    alert: false,
    done: 'Je betwisting is verstuurd. De aanvraag wordt opnieuw gevalideerd.',
  },
  [STEP.WITHDRAWAL]: {
    title: 'Aanvraag intrekken',
    intro:
      'De aanvraag wordt niet meer behandeld. Je kan dit niet ongedaan maken; dien zo nodig een nieuwe aanvraag in.',
    textLabel: null,
    confirmLabel: 'Intrekken',
    loadingLabel: 'Aanvraag intrekken',
    alert: true,
    done: 'De aanvraag is ingetrokken.',
  },
  [STEP.REAPPLY]: {
    title: 'Aanvraag opnieuw toepassen',
    intro:
      'De goedgekeurde gegevens worden opnieuw doorgevoerd in het register.',
    textLabel: null,
    confirmLabel: 'Opnieuw toepassen',
    loadingLabel: 'Aanvraag toepassen',
    alert: false,
    done: 'De aanvraag is doorgevoerd.',
  },
};

/**
 * The modal that takes a step on a change request: a decision by ABB
 * (goedkeuring, afkeuring, informatievraag), the requester's answer or
 * contest, a withdrawal, or applying a failed request again. It posts the
 * step to the service and hands the updated request back.
 *
 * Arguments:
 * - `@step`: the step type (`STEP` of the constants)
 * - `@request`: the JSON:API document of the request (with its `conflicts`
 *   and `conflicts-token`, for a goedkeuring over changed data)
 * - `@onClose`: called when the user cancels
 * - `@onDone`: called with the updated request document and the message
 *   for the user once the step is taken
 */
export default class ChangeRequestsStepModalComponent extends Component {
  @service changeRequests;

  @tracked text = '';
  @tracked textError = null;
  @tracked error = null;
  @tracked overrideConfirmed = false;
  /**
   * The conflicts to show and the token that overrides exactly them: those
   * of the request as loaded, replaced by what the service answers when it
   * refuses an approval because they changed meanwhile.
   */
  @tracked liveConflicts = null;
  @tracked liveToken = null;

  get config() {
    return STEPS[this.args.step] ?? STEPS[STEP.WITHDRAWAL];
  }

  get isApproval() {
    return this.args.step === STEP.APPROVAL;
  }

  get conflicts() {
    if (!this.isApproval) {
      return [];
    }
    const conflicts =
      this.liveConflicts ?? this.args.request?.attributes?.conflicts ?? [];
    return conflicts.map((conflict) => ({
      label: `${fieldLabel(conflict.resource?.type, conflict.key)}`,
      current: describe(conflict.current),
      proposed: describe(conflict.proposed),
    }));
  }

  get conflictsToken() {
    return (
      this.liveToken ?? this.args.request?.attributes?.['conflicts-token'] ?? null
    );
  }

  @action
  updateText(event) {
    this.text = event.target.value;
    this.textError = null;
  }

  @action
  toggleOverride() {
    this.overrideConfirmed = !this.overrideConfirmed;
  }

  submit = dropTask(async () => {
    this.error = null;
    const { config } = this;
    const text = this.text.trim();
    if (config.textLabel && !text) {
      this.textError = config.textError;
      return;
    }
    if (this.conflicts.length && !this.overrideConfirmed) {
      this.error =
        'Bevestig dat je de intussen gewijzigde gegevens hebt bekeken, of annuleer.';
      return;
    }
    try {
      const document = await this.changeRequests.takeDecision(
        this.args.request.id,
        this.args.step,
        {
          reason: text || null,
          override:
            this.isApproval && this.conflicts.length ? this.conflictsToken : null,
        },
      );
      this.args.onDone?.(document, config.done);
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      if (this.isApproval && error.status === 409 && error.conflicts.length) {
        // The conflicts changed since they were shown: show the current
        // ones and ask for the confirmation again
        this.liveConflicts = error.conflicts;
        this.liveToken = error.conflictsToken;
        this.overrideConfirmed = false;
        this.error =
          'De gegevens zijn intussen opnieuw gewijzigd. Bekijk de verschillen en bevestig opnieuw.';
        return;
      }
      this.error = error.message;
    }
  });
}

/**
 * A conflict value as the modal lists it.
 */
export function describe(value) {
  if (value === null || value === undefined || value === '') {
    return 'leeg';
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(describe).join(', ') : 'leeg';
  }
  if (typeof value === 'object') {
    return value.id ?? JSON.stringify(value);
  }
  return String(value);
}
