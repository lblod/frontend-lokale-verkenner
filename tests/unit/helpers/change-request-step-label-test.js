import { module, test } from 'qunit';
import { stepLabel } from 'frontend-organization-portal/constants/change-requests';

module('Unit | Helper | change-request-step-label', function () {
  test('a step that applies the request says when the apply failed', function (assert) {
    assert.strictEqual(
      stepLabel('afhandeling', 'afgehandeld'),
      'Gegevens aangepast in het register',
    );
    assert.strictEqual(
      stepLabel('afhandeling', 'mislukt'),
      'Doorvoeren mislukt',
    );
    assert.strictEqual(
      stepLabel('hertoepassing', 'mislukt'),
      'Opnieuw toepassen mislukt',
    );
    assert.strictEqual(stepLabel('afkeuring', 'afgekeurd'), 'Afgekeurd');
    assert.strictEqual(stepLabel('onbekend'), 'onbekend');
    assert.strictEqual(stepLabel(undefined), '');
  });
});
