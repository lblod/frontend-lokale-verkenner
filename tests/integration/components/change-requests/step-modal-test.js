import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { click, fillIn, render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

const TEMPLATE = hbs`
  <AuModalContainer />
  <ChangeRequests::StepModal
    @step={{this.step}}
    @request={{this.request}}
    @onClose={{this.onClose}}
    @onDone={{this.onDone}}
    @onApplyFailed={{this.onApplyFailed}}
  />
`;

const CONFLICT = {
  resource: { type: 'administrative-units', id: 'org-1' },
  key: 'name',
  base: 'Aalst',
  current: 'Aalst (ABB)',
  proposed: 'Stad Aalst',
  'competing-requests': [],
};

module(
  'Integration | Component | change-requests/step-modal',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function () {
      this.takeDecision = sinon.stub(
        this.owner.lookup('service:change-requests'),
        'takeDecision',
      );
      this.onClose = sinon.stub();
      this.onDone = sinon.stub();
      this.onApplyFailed = sinon.stub();
      this.request = {
        id: 'cr-1',
        attributes: {
          status: 'ingediend',
          conflicts: [],
          'conflicts-token': null,
        },
      };
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('a rejection needs a reason, which it posts; the updated request and a message go back to the page', async function (assert) {
      this.step = 'afkeuring';
      this.takeDecision.resolves({
        id: 'cr-1',
        attributes: { status: 'afgekeurd' },
      });

      await render(TEMPLATE);

      assert.dom(this.element).includesText('Aanvraag afkeuren');
      await click('[data-test-step-confirm]');
      assert.dom(this.element).includesText('Geef de reden van de afkeuring.');
      assert.true(this.takeDecision.notCalled);

      await fillIn('[data-test-step-text]', 'Het KBO-nummer klopt niet');
      await click('[data-test-step-confirm]');

      assert.true(
        this.takeDecision.calledOnceWithExactly('cr-1', 'afkeuring', {
          reason: 'Het KBO-nummer klopt niet',
          override: null,
        }),
      );
      assert.true(
        this.onDone.calledOnceWith(
          sinon.match({ id: 'cr-1' }),
          'De aanvraag is afgekeurd.',
        ),
      );
    });

    test('an approval over changed data shows the conflicts and needs the confirmation, then overrides exactly them', async function (assert) {
      this.step = 'goedkeuring';
      this.request = {
        id: 'cr-1',
        attributes: {
          status: 'ingediend',
          conflicts: [CONFLICT],
          'conflicts-token': 'tok-1',
        },
      };
      this.takeDecision.resolves({
        id: 'cr-1',
        attributes: { status: 'afgehandeld' },
      });

      await render(TEMPLATE);

      assert.dom('[data-test-step-conflicts]').includesText('Naam');
      assert.dom('[data-test-step-conflicts]').includesText('Aalst (ABB)');
      assert.dom('[data-test-step-conflicts]').includesText('Stad Aalst');

      await click('[data-test-step-confirm]');
      assert.true(this.takeDecision.notCalled, 'not without the confirmation');
      assert.dom('[data-test-step-error]').includesText('Bevestig');

      await click('[data-test-step-override]');
      await click('[data-test-step-confirm]');

      assert.true(
        this.takeDecision.calledOnceWithExactly('cr-1', 'goedkeuring', {
          reason: null,
          override: 'tok-1',
        }),
      );
      assert.true(this.onDone.calledOnce);
    });

    test('when the data changed again meanwhile the service refuses: the current conflicts are shown and the confirmation asked again', async function (assert) {
      this.step = 'goedkeuring';
      this.takeDecision.onFirstCall().rejects(
        new ChangeRequestError('De gegevens zijn intussen gewijzigd.', {
          status: 409,
          conflicts: [
            {
              ...CONFLICT,
              resource: { type: 'addresses', id: 'a-1' },
              key: 'street',
              current: 'Markt',
              proposed: 'Grote Markt',
            },
          ],
          conflictsToken: 'tok-2',
        }),
      );
      this.takeDecision.onSecondCall().resolves({
        id: 'cr-1',
        attributes: { status: 'afgehandeld' },
      });

      await render(TEMPLATE);

      assert.dom('[data-test-step-conflicts]').doesNotExist();
      await click('[data-test-step-confirm]');

      assert.dom('[data-test-step-conflicts]').includesText('Straat');
      assert.dom('[data-test-step-conflicts]').includesText('Grote Markt');
      assert.dom('[data-test-step-error]').includesText('opnieuw gewijzigd');
      assert.true(this.onDone.notCalled);

      await click('[data-test-step-override]');
      await click('[data-test-step-confirm]');

      assert.deepEqual(this.takeDecision.secondCall.args, [
        'cr-1',
        'goedkeuring',
        { reason: null, override: 'tok-2' },
      ]);
      assert.true(this.onDone.calledOnce);
    });

    test('a refused step shows the message of the service and keeps the modal open; cancelling closes it', async function (assert) {
      this.step = 'intrekking';
      this.takeDecision.rejects(
        new ChangeRequestError(
          'Deze stap is niet meer mogelijk: de aanvraag is intussen afgekeurd.',
          { status: 409 },
        ),
      );

      await render(TEMPLATE);

      assert.dom(this.element).includesText('Aanvraag intrekken');
      assert.dom('[data-test-step-text]').doesNotExist('no text asked');
      await click('[data-test-step-confirm]');

      assert.dom('[data-test-step-error]').includesText('niet meer mogelijk');
      assert.true(this.onDone.notCalled);

      await click('[data-test-step-cancel]');
      assert.true(this.onClose.calledOnce);
    });

    test('the conflicts name the records a relationship points at, also those the request creates', async function (assert) {
      this.step = 'goedkeuring';
      const store = this.owner.lookup('service:store');
      sinon.stub(store, 'request').callsFake(async ({ data }) => ({
        content: { id: data.record.id, label: 'Autonoom gemeentebedrijf' },
      }));
      this.request = {
        id: 'cr-1',
        attributes: {
          status: 'ingediend',
          conflicts: [
            {
              ...CONFLICT,
              key: 'legal-form',
              current: {
                type: 'concepts',
                id: '1f6ab8c6-a59e-4fea-9b39-26cb1b2d4c3d',
              },
              proposed: { type: 'concepts', id: 'new-legal-form' },
            },
          ],
          'conflicts-token': 'tok-1',
          operations: [
            {
              op: 'create',
              data: {
                type: 'concepts',
                id: 'new-legal-form',
                attributes: {},
              },
            },
          ],
        },
      };

      await render(TEMPLATE);

      assert.dom('[data-test-step-conflicts]').includesText('Juridische vorm');
      assert
        .dom('[data-test-step-conflicts]')
        .includesText(
          'Autonoom gemeentebedrijf',
          'the current value by its label',
        );
      assert
        .dom('[data-test-step-conflicts]')
        .doesNotIncludeText('1f6ab8c6', 'not as a uuid');
    });

    test('an approval whose apply fails hands the message to the page, which shows the request anew', async function (assert) {
      this.step = 'goedkeuring';
      this.takeDecision.rejects(
        new ChangeRequestError('Het doorvoeren van de aanvraag mislukte.', {
          status: 409,
          applyFailed: true,
          requestId: 'cr-1',
        }),
      );

      await render(TEMPLATE);
      await click('[data-test-step-confirm]');

      assert.true(
        this.onApplyFailed.calledOnceWithExactly(
          'Het doorvoeren van de aanvraag mislukte.',
        ),
      );
      assert.true(this.onDone.notCalled);
    });

    test('the decision modals promise no notification nothing sends', async function (assert) {
      for (const step of ['goedkeuring', 'afkeuring']) {
        this.set('step', step);
        await render(TEMPLATE);
        assert.dom(this.element).doesNotIncludeText('melding');
      }
    });
  },
);
