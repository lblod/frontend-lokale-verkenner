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

/** What each step asks of the user, in the design's words. */
const STEPS = {
  [STEP.APPROVAL]: {
    title: 'Aanvraag goedkeuren?',
    intro:
      'Ben je zeker dat je deze aanvraag wilt goedkeuren? De aanvrager krijgt hiervan een melding.',
    textLabel: null,
    confirmLabel: 'Goedkeuren',
    loadingLabel: 'Aanvraag goedkeuren',
    alert: false,
    done: 'De aanvraag is goedgekeurd en doorgevoerd.',
  },
  [STEP.REJECTION]: {
    title: 'Aanvraag afkeuren?',
    intro:
      'Ben je zeker dat je deze aanvraag wilt afkeuren? De aanvrager krijgt hiervan een melding',
    textLabel: 'Reden van afkeuring',
    textError: 'Geef de reden van de afkeuring.',
    singleLine: true,
    confirmLabel: 'Afkeuren',
    loadingLabel: 'Aanvraag afkeuren',
    alert: true,
    done: 'De aanvraag is afgekeurd.',
  },
  [STEP.INFORMATION_REQUEST]: {
    title: 'Extra informatie opvragen',
    intro:
      'Welke informatie ontbreekt er nog? De aanvrager ontvangt je bericht en kan de aanvraag daarna aanvullen.',
    textLabel: 'Jouw vraag aan de aanvrager',
    textError: 'Formuleer je vraag.',
    confirmLabel: 'Verzenden',
    loadingLabel: 'Vraag versturen',
    alert: false,
    done: 'Je vraag is verstuurd naar de aanvrager.',
  },
  [STEP.INFORMATION_ANSWER]: {
    title: 'Beantwoord de aanvullende vraag',
    textLabel: 'Aanvullende vraag',
    textError: 'Vul je antwoord in.',
    confirmLabel: 'Verzenden',
    loadingLabel: 'Antwoord versturen',
    alert: false,
    done: 'Je antwoord is verstuurd. De aanvraag wordt opnieuw gevalideerd.',
  },
  [STEP.CONTEST]: {
    title: 'Beslissing betwisten',
    textLabel: 'Waarom ben je het niet eens met de beslissing?',
    textHelp:
      'Leg uit waarom je vindt dat de aanvraag toch goedgekeurd moet worden. Wees zo grondig mogelijk.',
    textError: 'Leg uit waarom je de beslissing betwist.',
    confirmLabel: 'Verzenden',
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
};

/**
 * The modal that takes a step on a change request: a decision by ABB
 * (goedkeuring, afkeuring, informatievraag), the requester's answer or
 * contest, or a withdrawal. It posts the step to the service and hands the
 * updated request back.
 *
 * Arguments:
 * - `@step`: the step type (`STEP` of the constants)
 * - `@request`: the JSON:API document of the request (with its `conflicts`
 *   and `conflicts-token`, for a goedkeuring over changed data)
 * - `@question`: the question of ABB, for the requester's answer
 * - `@onClose`: called when the user cancels
 * - `@onDone`: called with the updated request document and the message
 *   for the user once the step is taken
 * - `@onApplyFailed`: called with the message for the user when a
 *   goedkeuring was taken but applying the request failed: the request is
 *   now `mislukt`
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

  /**
   * The label above the text field: the question of ABB when the requester
   * answers it, the config's label otherwise.
   */
  get textLabel() {
    if (this.args.step === STEP.INFORMATION_ANSWER) {
      return this.args.question || this.config.textLabel;
    }
    return this.config.textLabel;
  }

  get conflicts() {
    if (!this.isApproval) {
      return [];
    }
    const conflicts =
      this.liveConflicts ?? this.args.request?.attributes?.conflicts ?? [];
    return conflicts.map((conflict) => ({
      label: `${fieldLabel(conflict.resource?.type, conflict.key)}`,
      current: valueParts(conflict.current),
      proposed: valueParts(conflict.proposed),
    }));
  }

  get conflictsToken() {
    return (
      this.liveToken ??
      this.args.request?.attributes?.['conflicts-token'] ??
      null
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
            this.isApproval && this.conflicts.length
              ? this.conflictsToken
              : null,
        },
      );
      this.args.onDone?.(document, config.done);
    } catch (error) {
      if (!(error instanceof ChangeRequestError)) {
        throw error;
      }
      if (error.applyFailed) {
        this.args.onApplyFailed?.(error.message);
        return;
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
 * A conflict value as the modal lists it: its parts, each a text or a
 * `reference` (`{ type, id }`) to a record, which the modal names
 * (`ChangeRequests::ResourceReference`); "leeg" for no value.
 */
export function valueParts(value) {
  if (value === null || value === undefined || value === '') {
    return [{ text: 'leeg' }];
  }
  if (Array.isArray(value)) {
    return value.length ? value.flatMap(valueParts) : [{ text: 'leeg' }];
  }
  if (typeof value === 'object') {
    return value.type && value.id
      ? [{ reference: value }]
      : [{ text: JSON.stringify(value) }];
  }
  return [{ text: String(value) }];
}
