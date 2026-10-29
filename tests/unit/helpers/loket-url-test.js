import { module, test } from 'qunit';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import config from 'frontend-organization-portal/config/environment';
import { loketUrl } from 'frontend-organization-portal/helpers/loket-url';

module('Unit | Helper | loket-url', function (hooks) {
  setupTest(hooks);

  hooks.afterEach(function () {
    delete config.loketUrl;
  });

  test('it gives the configured address, and nothing for a placeholder or an empty value', function (assert) {
    config.loketUrl = 'https://loket.lokaalbestuur.vlaanderen.be';
    assert.strictEqual(loketUrl(), 'https://loket.lokaalbestuur.vlaanderen.be');

    config.loketUrl = '{{LOKET_URL}}';
    assert.strictEqual(
      loketUrl(),
      null,
      'the placeholder of a deployment without Loket',
    );

    config.loketUrl = '';
    assert.strictEqual(loketUrl(), null);

    delete config.loketUrl;
    assert.strictEqual(loketUrl(), null);
  });
});
