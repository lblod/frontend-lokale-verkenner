import { module, test } from 'qunit';
import sinon from 'sinon';
import Component from '@glimmer/component';
import { setComponentTemplate } from '@ember/component';
import { click, render, settled, waitFor } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { ADDITIONAL_QUALIFICATIONS } from 'frontend-organization-portal/models/additional-qualification-code';

/**
 * A component that copies its argument when it is created, as the address
 * search and the rich-text editor of the edit pages do.
 */
class CopiesItsArgument extends Component {
  value = this.args.value;
}
setComponentTemplate(
  hbs`<span data-test-copy>{{this.value}}</span>`,
  CopiesItsArgument,
);

module('Integration | Component | rebuild', function (hooks) {
  setupRenderingTest(hooks);

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('it creates the components of its block anew when the key changes', async function (assert) {
    this.CopiesItsArgument = CopiesItsArgument;
    this.value = 'Gemeente Aalst';
    this.revision = 0;

    await render(hbs`
      <Rebuild @key={{this.revision}}>
        <this.CopiesItsArgument @value={{this.value}} />
      </Rebuild>
    `);

    assert.dom('[data-test-copy]').hasText('Gemeente Aalst');

    this.set('value', 'Stad Aalst');
    await settled();

    assert
      .dom('[data-test-copy]')
      .hasText(
        'Gemeente Aalst',
        'a component keeps the value it was created with',
      );

    this.set('revision', 1);
    await settled();

    assert.dom('[data-test-copy]').hasText('Stad Aalst');
  });

  test('the qualifications choice shows the reloaded qualifications once the form is built anew, not the choice of the held save', async function (assert) {
    const store = this.owner.lookup('service:store');
    sinon.stub(this.owner.lookup('adapter:application'), 'query').resolves({
      data: [
        {
          type: 'additional-qualification-codes',
          id: ADDITIONAL_QUALIFICATIONS.NONE,
          attributes: { label: 'Geen bijkomende kwalificatie' },
        },
        {
          type: 'additional-qualification-codes',
          id: '533227c3-931b-43f0-8669-b91375d1556b',
          attributes: { label: 'Erkende regionale samenwerking' },
        },
      ],
    });
    const stored = store.push({
      data: {
        type: 'additional-qualification-code',
        id: '533227c3-931b-43f0-8669-b91375d1556b',
        attributes: { label: 'Erkende regionale samenwerking' },
      },
    });
    this.selected = [stored];
    this.revision = 0;
    this.onChange = (selected) => this.set('selected', selected);

    await render(hbs`
      <Rebuild @key={{this.revision}}>
        <AdditionalQualificationsSelect
          @selected={{this.selected}}
          @onChange={{this.onChange}}
        />
      </Rebuild>
    `);
    await waitFor('input[value="yes"]');

    assert.dom('input[value="yes"]').isChecked();

    // The user answers "Nee"; the save is held, and the page reloads the
    // stored qualifications
    await click('input[value="no"]');
    this.set('selected', [stored]);
    await settled();

    assert
      .dom('input[value="no"]')
      .isChecked('the component keeps the choice it made');

    this.set('revision', 1);
    await waitFor('input[value="yes"]');

    assert
      .dom('input[value="yes"]')
      .isChecked('the stored qualifications, as the page now shows them');
  });
});
