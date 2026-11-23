import { module, test } from 'qunit';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module('Integration | Component | data-card/item', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders the title above the content', async function (assert) {
    await render(hbs`
      <DataCard::Item>
        <:label>Label</:label>
        <:content>Content</:content>
      </DataCard::Item>
    `);

    assert.dom('.au-c-card-item__label').hasText('Label');
    assert.dom('.au-c-card-item').doesNotContainText('Verplicht');

    const item = this.element.querySelector('.au-c-card-item');
    assert
      .dom(item.firstElementChild)
      .hasClass('au-c-card-item__label')
      .hasClass('au-c-card-item__label--data');
    assert.dom('.au-c-card-item__content').hasText('Content');
    assert.dom('.au-c-icon--info-circle').doesNotExist();
  });
});
