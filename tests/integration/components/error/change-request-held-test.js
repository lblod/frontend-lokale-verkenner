import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { click, render, settled } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

const REQUEST_ID = '47b4a8ba-1229-409e-a326-ac4250defec4';

module('Integration | Component | error/change-request-held', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    this.withdraw = sinon.stub(
      this.owner.lookup('service:change-requests'),
      'withdraw',
    );
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('it renders nothing when the last save was not held', async function (assert) {
    this.held = null;

    await render(hbs`<Error::ChangeRequestHeld @held={{this.held}} />`);

    assert.dom('[role="alert"]').doesNotExist();
  });

  test('it names the fields someone else changed and says that the request waits for ABB', async function (assert) {
    this.held = { fields: ['Juridische naam', 'Straat'], waiting: true };

    await render(hbs`
        <Error::ChangeRequestHeld @held={{this.held}}>
          Het formulier toont de gegevens zoals ze nu opgeslagen zijn.
        </Error::ChangeRequestHeld>
      `);

    assert.dom('[data-test-alert-title]').hasText('Wijziging niet doorgevoerd');
    assert
      .dom('[data-test-alert-message]')
      .hasText(
        'Je wijziging werd niet doorgevoerd omdat iemand anders intussen dezelfde gegevens heeft gewijzigd: Juridische naam, Straat. Je aanvraag wacht op een beslissing van ABB. Het formulier toont de gegevens zoals ze nu opgeslagen zijn.',
      );
  });

  test('it explains that saving the same fields again replaces the held request, and withdraws it', async function (assert) {
    this.held = {
      id: REQUEST_ID,
      fields: ['Juridische naam'],
      reloadFailed: false,
      waiting: true,
    };
    this.withdraw.resolves();

    await render(hbs`
        <Error::ChangeRequestHeld @held={{this.held}}>
          Het formulier toont de gegevens zoals ze nu opgeslagen zijn.
        </Error::ChangeRequestHeld>
      `);

    assert
      .dom('[data-test-held-competing]')
      .hasText(
        'Sla je dezelfde gegevens opnieuw op, dan vervangt je nieuwe wijziging deze aanvraag en wordt ze automatisch ingetrokken. Wijzig je maar een deel ervan, dan blijft deze aanvraag wachten op ABB naast je nieuwe wijziging.',
      );

    await click('[data-test-held-withdraw]');

    assert.true(this.withdraw.calledOnceWithExactly(REQUEST_ID));
    assert
      .dom('[data-test-alert-message]')
      .hasText(
        'Je wijziging werd niet doorgevoerd omdat iemand anders intussen dezelfde gegevens heeft gewijzigd: Juridische naam. Je hebt je aanvraag ingetrokken. Het formulier toont de gegevens zoals ze nu opgeslagen zijn.',
      );
    assert.dom('[data-test-held-withdraw]').doesNotExist();
    assert.dom('[data-test-held-competing]').doesNotExist();

    // A later save that is held again has a request of its own
    this.set('held', {
      id: '6b8ed552-2bfb-417f-bf1e-4a1da50781aa',
      fields: ['Juridische naam'],
      reloadFailed: false,
      waiting: true,
    });
    await settled();

    assert.dom('[data-test-held-withdraw]').exists();
    assert
      .dom('[data-test-alert-message]')
      .includesText('Je aanvraag wacht op een beslissing van ABB.');
  });

  test('it says why the held request could not be withdrawn', async function (assert) {
    this.held = {
      id: REQUEST_ID,
      fields: [],
      reloadFailed: false,
      waiting: true,
    };
    this.withdraw.rejects(
      new ChangeRequestError(
        'ABB heeft je aanvraag intussen goedgekeurd; ze kan niet meer ingetrokken worden.',
        { status: 409 },
      ),
    );

    await render(hbs`<Error::ChangeRequestHeld @held={{this.held}} />`);
    await click('[data-test-held-withdraw]');

    assert
      .dom('[data-test-held-withdraw-error]')
      .hasText(
        'ABB heeft je aanvraag intussen goedgekeurd; ze kan niet meer ingetrokken worden.',
      );
    assert
      .dom('[data-test-alert-message]')
      .includesText('Je aanvraag wacht op een beslissing van ABB.');
  });

  test('it asks for a reload instead of showing its block when the records could not be reloaded', async function (assert) {
    this.held = {
      id: REQUEST_ID,
      fields: ['Straat'],
      reloadFailed: true,
      waiting: true,
    };

    await render(hbs`
        <Error::ChangeRequestHeld @held={{this.held}}>
          Het formulier toont de gegevens zoals ze nu opgeslagen zijn.
        </Error::ChangeRequestHeld>
      `);

    assert
      .dom('[data-test-alert-message] p')
      .hasText(
        'Je wijziging werd niet doorgevoerd omdat iemand anders intussen dezelfde gegevens heeft gewijzigd: Straat. Je aanvraag wacht op een beslissing van ABB. De gegevens konden niet vernieuwd worden; herlaad de pagina voor je opnieuw opslaat.',
      );
  });

  test('it says nothing about ABB and offers no withdrawal for a stale edit the service refused', async function (assert) {
    this.held = {
      id: null,
      fields: ['Juridische naam'],
      reloadFailed: false,
      waiting: false,
    };

    await render(hbs`
        <Error::ChangeRequestHeld @held={{this.held}}>
          Het formulier toont de gegevens zoals ze nu opgeslagen zijn.
        </Error::ChangeRequestHeld>
      `);

    assert
      .dom('[data-test-alert-message]')
      .hasText(
        'Je wijziging werd niet doorgevoerd omdat iemand anders intussen dezelfde gegevens heeft gewijzigd: Juridische naam. Het formulier toont de gegevens zoals ze nu opgeslagen zijn.',
      );
    assert.dom('[data-test-held-withdraw]').doesNotExist();
    assert.dom('[data-test-held-competing]').doesNotExist();
  });

  test('it leaves out the fields when the service named none', async function (assert) {
    this.held = { fields: [], waiting: true };

    await render(hbs`<Error::ChangeRequestHeld @held={{this.held}} />`);

    assert
      .dom('[data-test-alert-message]')
      .hasText(
        'Je wijziging werd niet doorgevoerd. Je aanvraag wacht op een beslissing van ABB.',
      );
  });
});
