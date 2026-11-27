import { module, test } from 'qunit';
import { historyEntries } from 'frontend-organization-portal/utils/change-request-steps';

module('Unit | Utility | change-request-steps', function () {
  test('it gives each step its text, the hidden note and a short version for the cell', function (assert) {
    const longReason = 'a'.repeat(70);
    const steps = [
      { sequence: 1, type: 'indiening', reason: null },
      { sequence: 2, type: 'informatievraag', reason: null },
      { sequence: 3, type: 'informatieantwoord', reason: 'Zie bijlage' },
      { sequence: 4, type: 'afkeuring', reason: longReason },
      { sequence: 5, type: 'afhandeling', error: 'Virtuoso 42000 Error SR325' },
      { sequence: 6, type: 'goedkeuring' },
    ];
    const entries = historyEntries({ request: { attributes: { steps } } });

    assert.deepEqual(
      entries.map(({ details }) => details),
      [
        '',
        'Enkel zichtbaar voor de aanvrager en ABB',
        'Zie bijlage',
        longReason,
        'Virtuoso 42000 Error SR325',
        '',
      ],
    );
    assert.false(entries[0].truncated);
    assert.true(entries[3].truncated);
    assert.strictEqual(entries[3].shortDetails, `${'a'.repeat(60)}…`);
    assert.strictEqual(entries[2].step, steps[2], 'the step itself is kept');
  });

  test('it handles a request without steps', function (assert) {
    assert.deepEqual(historyEntries({ request: null }), []);
  });
});
