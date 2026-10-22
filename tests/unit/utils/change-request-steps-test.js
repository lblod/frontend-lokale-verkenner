import { module, test } from 'qunit';
import { stepsWithActors } from 'frontend-organization-portal/utils/change-request-steps';

module('Unit | Utility | change-request-steps', function () {
  test('it names who took each step: the requesting organisation, ABB or the service, and flags a hidden text', function (assert) {
    const steps = [
      {
        sequence: 1,
        type: 'indiening',
        organisation: 'org-1',
        agent: 'user',
        reason: null,
      },
      {
        sequence: 2,
        type: 'informatievraag',
        organisation: 'abb',
        agent: 'user',
        reason: null,
      },
      {
        sequence: 3,
        type: 'informatieantwoord',
        organisation: 'org-1',
        agent: 'user',
        reason: 'Zie bijlage',
      },
      {
        sequence: 4,
        type: 'goedkeuring',
        organisation: 'abb',
        agent: 'user',
        reason: null,
      },
      {
        sequence: 5,
        type: 'afhandeling',
        organisation: null,
        agent: 'service',
        reason: null,
        error: null,
      },
    ];
    const entries = stepsWithActors({
      request: { attributes: { steps } },
      requesterId: 'org-1',
      requester: { id: 'org-1', abbName: 'Gemeente Aalst' },
    });

    assert.deepEqual(
      entries.map(({ actor, hiddenText }) => [actor, hiddenText]),
      [
        ['Gemeente Aalst', false],
        ['ABB', true],
        ['Gemeente Aalst', false],
        ['ABB', false],
        ['Automatisch', false],
      ],
    );
    assert.strictEqual(entries[2].step, steps[2], 'the step itself is kept');
  });

  test('it falls back to "de aanvrager" when the organisation could not be loaded', function (assert) {
    const entries = stepsWithActors({
      request: {
        attributes: {
          steps: [{ type: 'indiening', organisation: 'org-1', agent: 'user' }],
        },
      },
      requesterId: 'org-1',
      requester: null,
    });

    assert.strictEqual(entries[0].actor, 'de aanvrager');
  });
});
