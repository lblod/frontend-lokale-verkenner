import { module, test } from 'qunit';
import { setupTest } from 'frontend-organization-portal/tests/helpers';

module('Unit | Controller | aanvragen/aanvraag/geschiedenis', function (hooks) {
  setupTest(hooks);

  test('the steps are listed newest first, as the design shows them', function (assert) {
    const controller = this.owner.lookup(
      'controller:aanvragen/aanvraag/geschiedenis',
    );
    controller.model = {
      request: {
        attributes: {
          steps: [
            { sequence: 1, type: 'indiening', organisation: 'org-1' },
            { sequence: 2, type: 'afkeuring', organisation: 'abb' },
            { sequence: 3, type: 'betwisting', organisation: 'org-1' },
          ],
        },
      },
      requesterId: 'org-1',
      requester: { id: 'org-1', abbName: 'Gemeente Aalst' },
    };

    assert.deepEqual(
      controller.history.map(({ step }) => step.type),
      ['betwisting', 'afkeuring', 'indiening'],
    );
  });
});
