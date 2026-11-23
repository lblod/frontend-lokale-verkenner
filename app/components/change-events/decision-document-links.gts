import AuButton from '@appuniversum/ember-appuniversum/components/au-button';
import AuHelpText from '@appuniversum/ember-appuniversum/components/au-help-text';
import AuLabel from '@appuniversum/ember-appuniversum/components/au-label';
import AuRadioGroup from '@appuniversum/ember-appuniversum/components/au-radio-group';
import AuTextarea from '@appuniversum/ember-appuniversum/components/au-textarea';
import { action } from '@ember/object';
import { fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import TrimInput from 'frontend-organization-portal/components/trim-input';

type Choice = 'links' | 'text' | 'none';

interface Decision {
  documentLinks: string[];
  description?: string | null;
  geenLinkBeschikbaar?: string | null;
  removeError: (propName: string) => void;
  error?: {
    description?: { message: string };
    geenLinkBeschikbaar?: { message: string };
  } & Record<string, { message: string }>;
}

interface Signature {
  Args: {
    decision: Decision;
    errors?: Array<{ message: string }>;
  };
}

/**
 * The links to the besluit: one or more links, a text when the link is not
 * known, or a message saying no link is available. One value per option:
 * links live in `documentLinks`, the text in `description` and the message in
 * `geenLinkBeschikbaar`; picking an option clears the values of the others.
 */
export default class DecisionDocumentLinks extends Component<Signature> {
  @tracked choice?: Choice;
  // The rows as rendered. The model's `documentLinks` is written on every
  // change, but this stack does not re-render the list from an `@attr` that
  // the component assigned itself, so the list reads this copy.
  @tracked links = [...(this.args?.decision?.documentLinks ?? [])];

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    if (this.args.decision.documentLinks?.some((link) => link)) {
      this.choice = 'links';
    } else if (this.args.decision.description) {
      this.choice = 'text';
    } else if (this.args.decision.geenLinkBeschikbaar) {
      this.choice = 'none';
    }
  }

  get showLinks() {
    return this.choice === 'links';
  }

  get showText() {
    return this.choice === 'text';
  }

  get showNoLink() {
    return this.choice === 'none';
  }

  @action
  handleChoiceChange(value?: string) {
    this.choice = value as Choice | undefined;

    const { decision } = this.args;
    if (this.choice !== 'links') {
      this.links = [];
      decision.documentLinks = [];
      decision.removeError('documentLinks');
    }
    if (this.choice !== 'text') {
      decision.description = null;
      decision.removeError('description');
    }
    if (this.choice !== 'none') {
      decision.geenLinkBeschikbaar = null;
      decision.removeError('geenLinkBeschikbaar');
    }
  }

  @action
  setDescription(event: Event) {
    this.args.decision.description = (
      event.target as HTMLTextAreaElement
    ).value;
  }

  @action
  setGeenLinkBeschikbaar(event: Event) {
    this.args.decision.geenLinkBeschikbaar = (
      event.target as HTMLTextAreaElement
    ).value;
  }

  @action
  addLink() {
    this.links = [...this.links, ''];
    this.args.decision.documentLinks = this.links;
  }

  @action
  updateLink(index: number, value: string) {
    this.links = this.links.map((link, i) => (i === index ? value : link));
    this.args.decision.documentLinks = this.links;
  }

  @action
  removeLink(index: number) {
    this.links = this.links.filter((_, i) => i !== index);
    this.args.decision.documentLinks = this.links;

    // We clear all errors for this field for now.
    this.args.decision.removeError('documentLinks');
  }

  <template>
    <AuRadioGroup
      @name="decision-links-choice"
      @selected={{this.choice}}
      @onChange={{this.handleChoiceChange}}
      as |Group|
    >
      <Group.Radio @value="links" id="decision-links-yes-links">
        Ja, één of meer links
      </Group.Radio>
      <Group.Radio @value="text" id="decision-links-yes-text">
        Ja, maar ik weet de link niet
      </Group.Radio>
      <Group.Radio @value="none" id="decision-links-no">
        Nee, ik heb geen link naar een besluit
      </Group.Radio>
    </AuRadioGroup>

    {{#if this.showLinks}}
      <div class="au-u-margin-top-small">
        {{#if this.links.length}}
          <ul class="au-o-flow au-o-flow--small">
            {{#each this.links key="@index" as |documentLink index|}}
              {{#let (get @errors index) as |error|}}
                <li>
                  <div class="au-u-flex au-u-flex--vertical-center">
                    <TrimInput
                      @value={{documentLink}}
                      @onUpdate={{fn this.updateLink index}}
                      @width="block"
                      @error={{if error true false}}
                      @id="change-event-decision-link-{{index}}"
                      placeholder="https://vlaanderen.be"
                      aria-label="Link {{displayIndex index}}"
                    />
                    <AuButton
                      @alert={{true}}
                      @skin="naked"
                      @icon="bin"
                      @hideText={{true}}
                      {{on "click" (fn this.removeLink index)}}
                    >
                      Verwijder link
                      {{displayIndex index}}
                    </AuButton>
                  </div>
                  {{#if error}}
                    <AuHelpText @error={{true}}>{{error.message}}</AuHelpText>
                  {{/if}}
                </li>
              {{/let}}
            {{/each}}
          </ul>
        {{else}}
          <AuHelpText class="au-u-text-center">
            Nog geen links toegevoegd
          </AuHelpText>
        {{/if}}

        <AuButton
          @skin="secondary"
          @icon="add"
          @width="block"
          class="au-u-margin-top-small"
          type="button"
          {{on "click" this.addLink}}
        >
          Nieuwe link toevoegen
        </AuButton>
      </div>
    {{/if}}

    {{#if this.showText}}
      <AuLabel for="decision-links-text-input" class="au-u-margin-top-small">
        Meer uitleg
      </AuLabel>
      <AuTextarea
        id="decision-links-text-input"
        @width="block"
        @error={{if @decision.error.description true false}}
        class="au-u-margin-top-small"
        value={{@decision.description}}
        {{on "input" this.setDescription}}
      />
      {{#if @decision.error.description}}
        <AuHelpText @error={{true}}>
          {{@decision.error.description.message}}
        </AuHelpText>
      {{/if}}
    {{/if}}

    {{#if this.showNoLink}}
      <AuLabel for="decision-links-none-input" class="au-u-margin-top-small">
        Meer uitleg
      </AuLabel>
      <AuTextarea
        id="decision-links-none-input"
        @width="block"
        @error={{if @decision.error.geenLinkBeschikbaar true false}}
        class="au-u-margin-top-small"
        value={{@decision.geenLinkBeschikbaar}}
        {{on "input" this.setGeenLinkBeschikbaar}}
      />
      {{#if @decision.error.geenLinkBeschikbaar}}
        <AuHelpText @error={{true}}>
          {{@decision.error.geenLinkBeschikbaar.message}}
        </AuHelpText>
      {{/if}}
    {{/if}}
  </template>
}

function displayIndex(index: number) {
  return index + 1;
}
