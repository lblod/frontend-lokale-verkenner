import { module, test } from 'qunit';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module('Integration | Component | change-requests/status', function (hooks) {
  setupRenderingTest(hooks);

  test('it shows the label of a status as a pill with its skin', async function (assert) {
    this.status = 'afgekeurd';

    await render(hbs`<ChangeRequests::Status @status={{this.status}} />`);

    assert.dom('.au-c-pill').hasText('Afgekeurd');
    assert.dom('.au-c-pill').hasClass('au-c-pill--error');

    this.set('status', 'informatie-gevraagd');
    assert.dom('.au-c-pill').hasText('Informatie gevraagd');
    assert.dom('.au-c-pill').hasClass('au-c-pill--warning');
  });

  test('it shows an unknown status as it is', async function (assert) {
    this.status = 'nieuw';

    await render(hbs`<ChangeRequests::Status @status={{this.status}} />`);

    assert.dom('.au-c-pill').hasText('nieuw');
  });
});
