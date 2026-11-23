import { module, test } from 'qunit';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module('Integration | Component | edit-card/item', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders the title, the content, then the error', async function (assert) {
    await render(hbs`
      <EditCard::Item @labelFor="field" @errorMessage="Required">
        <:label>Label</:label>
        <:content>Content</:content>
      </EditCard::Item>
    `);

    const item = this.element.querySelector('.au-c-card-item');
    const [label, content] = item.children;

    assert.dom(label).hasClass('au-c-card-item__label');
    assert.dom(label).hasText('Label');
    assert.dom(content).hasClass('au-c-card-item__content');
    assert
      .dom(content)
      .hasText('Content Required', 'the error sits below the content');
  });

  test('it shows a "Verplicht" pill beside the title when required', async function (assert) {
    await render(hbs`
      <EditCard::Item @labelFor="field" @required={{true}}>
        <:label>Label</:label>
        <:content>Content</:content>
      </EditCard::Item>
    `);

    const label = this.element.querySelector('.au-c-card-item__label');
    const title = label.querySelector('.au-c-label');
    const pill = label.querySelector('.au-c-pill');

    assert.dom(label).hasText('Label Verplicht');
    assert.dom(pill).hasText('Verplicht');
    assert.ok(
      title.contains(pill),
      'the pill is part of the label, so screen readers announce it',
    );

    const titleBox = title.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();

    assert.ok(
      titleBox.bottom > pillBox.top,
      'the pill sits on the same row as the title',
    );
    assert.ok(pillBox.bottom > titleBox.top, 'the title and pill overlap');
  });

  test('it shows no pill when not required', async function (assert) {
    await render(hbs`
      <EditCard::Item @labelFor="field">
        <:label>Label</:label>
        <:content>Content</:content>
      </EditCard::Item>
    `);

    assert.dom('.au-c-pill').doesNotExist();
    assert.dom('.au-c-card-item__label').hasText('Label');
  });

  test('it shows the help text below the title with an info icon', async function (assert) {
    await render(hbs`
      <EditCard::Item @labelFor="field">
        <:label>Label</:label>
        <:content>Content</:content>
        <:helpText>Help</:helpText>
      </EditCard::Item>
    `);

    const item = this.element.querySelector('.au-c-card-item');
    const [label, helpLine, content] = item.children;

    assert.dom(helpLine).hasClass('au-c-help-text--tertiary');
    assert.true(
      helpLine.textContent.endsWith('\n  Help\n'),
      'the help text follows the icon without an extra space',
    );
    assert.ok(
      helpLine.querySelector('.au-c-icon--info-circle'),
      'the help line starts with an info icon',
    );
    assert.dom(content).hasClass('au-c-card-item__content');
    assert.ok(
      label.compareDocumentPosition(helpLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test('it shows no help line without a help text', async function (assert) {
    await render(hbs`
      <EditCard::Item @labelFor="field">
        <:label>Label</:label>
        <:content>Content</:content>
      </EditCard::Item>
    `);

    assert.dom('.au-c-icon--info-circle').doesNotExist();
  });
});
