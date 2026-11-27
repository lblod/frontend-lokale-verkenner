import { module, test } from 'qunit';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import DateRequestFormat from 'frontend-organization-portal/helpers/date-request-format';

module('Unit | Helper | date-request-format', function (hooks) {
  setupTest(hooks);

  test('it adds the time to a date of today, and leaves other dates alone', function (assert) {
    const today = new Date();
    today.setHours(9, 5, 0, 0);
    const pad = (number) => String(number).padStart(2, '0');
    const day = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`;

    assert.strictEqual(DateRequestFormat.compute([today]), `${day} 09:05`);
    assert.strictEqual(
      DateRequestFormat.compute([new Date(2000, 0, 1, 10, 0)]),
      '01-01-2000',
      'an earlier day has no time',
    );
    assert.strictEqual(DateRequestFormat.compute(['niet-een-datum']), '');
    assert.strictEqual(DateRequestFormat.compute([null]), '');
    assert.strictEqual(DateRequestFormat.compute([undefined]), '');
  });
});
