import { module, test } from 'qunit';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module('Integration | Component | rich-text-editor', function (hooks) {
  setupRenderingTest(hooks);

  test('shown, it renders the markup the editor writes and nothing that runs', async function (assert) {
    window.richTextAttack = false;
    this.value =
      '<p>Het <strong>doel</strong></p><img src="data:," onerror="window.richTextAttack = true">';

    await render(hbs`<RichTextEditor @show={{true}} @value={{this.value}} />`);

    assert.dom('.rich-text-editor-content strong').hasText('doel');
    assert.dom('.rich-text-editor-content img').doesNotHaveAttribute('onerror');
    assert.false(window.richTextAttack);
    delete window.richTextAttack;
  });
});
