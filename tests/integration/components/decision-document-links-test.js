import { module, test } from 'qunit';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { click, render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module('Integration | Component | decision-document-links', function (hooks) {
  setupRenderingTest(hooks);

  test('picking another option drops the values and errors of the others', async function (assert) {
    const decision = this.owner
      .lookup('service:store')
      .createRecord('decision', {
        documentLinks: ['https://aalst.be/besluiten/2026/123'],
        description: 'Besluit van de gemeenteraad',
      });
    decision.addError('documentLinks', 'Geef een geldig internetadres in');
    decision.addError('description', 'Ongeldige tekst');
    this.decision = decision;
    await render(
      hbs`<ChangeEvents::DecisionDocumentLinks @decision={{this.decision}} />`,
    );
    assert.dom('#decision-links-yes-links').isChecked('the links open');

    await click('#decision-links-yes-text');
    assert.deepEqual(decision.documentLinks, [], 'the links are dropped');
    assert.strictEqual(decision.error?.documentLinks, undefined);
    assert.strictEqual(decision.description, 'Besluit van de gemeenteraad');
    assert.strictEqual(
      decision.error?.description?.message,
      'Ongeldige tekst',
      'the error of the text is kept',
    );

    await click('#decision-links-no');
    assert.strictEqual(decision.description, null, 'the text is dropped');
    assert.strictEqual(decision.error?.description, undefined);

    await click('#decision-links-yes-links');
    assert.strictEqual(decision.geenLinkBeschikbaar, null);
    assert.strictEqual(decision.error, undefined);
  });
});
