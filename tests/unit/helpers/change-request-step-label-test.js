import { module, test } from 'qunit';
import { stepLabel } from 'frontend-organization-portal/constants/change-requests';

module('Unit | Helper | change-request-step-label', function () {
  test('a step that applies the request says when the apply failed', function (assert) {
    assert.strictEqual(
      stepLabel('afhandeling', 'afgehandeld'),
      'Aanvraag is afgehandeld, gegevens zijn aangepast in het register',
    );
    assert.strictEqual(
      stepLabel('afhandeling', 'mislukt'),
      'Doorvoeren mislukt',
    );
    assert.strictEqual(
      stepLabel('hertoepassing', 'mislukt'),
      'Opnieuw toepassen mislukt',
    );
    assert.strictEqual(
      stepLabel('afkeuring', 'afgekeurd'),
      'Aanvraag is afgekeurd',
    );
    assert.strictEqual(
      stepLabel('goedkeuring', 'goedgekeurd'),
      'Aanvraag is goedgekeurd en wordt verwerkt',
    );
    assert.strictEqual(
      stepLabel('informatievraag', 'informatie-gevraagd'),
      'ABB vraagt aanvullende informatie op',
    );
    assert.strictEqual(
      stepLabel('informatieantwoord', 'ingediend'),
      'Aanvrager zend aanvullende informatie in',
    );
    assert.strictEqual(
      stepLabel('betwisting', 'ingediend'),
      'Beslissing wordt betwist',
    );
    assert.strictEqual(stepLabel('onbekend'), 'onbekend');
    assert.strictEqual(stepLabel(undefined), '');
  });
});
