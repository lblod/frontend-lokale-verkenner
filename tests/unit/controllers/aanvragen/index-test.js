import { module, test } from 'qunit';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import { ABB_CLASSIFICATION_ID } from 'frontend-organization-portal/controllers/aanvragen/index';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';

module('Unit | Controller | aanvragen/index', function (hooks) {
  setupTest(hooks);

  test('the filters offer the kinds and statuses the list holds', function (assert) {
    const controller = this.owner.lookup('controller:aanvragen/index');

    assert.deepEqual(
      controller.kindOptions.map(({ label }) => label),
      ['Nieuwe organisatie', 'Veranderingsgebeurtenis'],
      'an edit is history only',
    );
    assert.notOk(
      controller.statusOptions.some(({ key }) => key === 'goedgekeurd'),
      'goedgekeurd is followed by the afhandeling in the same update',
    );
    assert.strictEqual(controller.statusOptions.length, 6);
  });

  test('the organisation filters search the types that request and the types a request is about', function (assert) {
    const controller = this.owner.lookup('controller:aanvragen/index');

    assert.true(
      controller.requesterClassificationCodes.includes(ABB_CLASSIFICATION_ID),
      'ABB requests too',
    );
    assert.true(
      controller.requesterClassificationCodes.includes(
        CLASSIFICATION.MUNICIPALITY.id,
      ),
    );
    assert.true(
      controller.targetClassificationCodes.includes(CLASSIFICATION.AGB.id),
    );
    assert.false(
      controller.targetClassificationCodes.includes(ABB_CLASSIFICATION_ID),
    );
  });

  test('a picked organisation is shown at once, without loading it', function (assert) {
    const controller = this.owner.lookup('controller:aanvragen/index');
    const organization = { id: 'org-1', abbName: 'Gemeente Aalst' };

    controller.setRequester(organization);

    assert.strictEqual(controller.requester, 'org-1');
    assert.strictEqual(controller.selectedRequester, organization);

    controller.setRequester(null);
    assert.strictEqual(controller.requester, '');
    assert.strictEqual(controller.selectedRequester, null);
  });
});
