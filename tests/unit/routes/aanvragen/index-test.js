import { module, test } from 'qunit';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import {
  startOfDay,
  endOfDay,
} from 'frontend-organization-portal/routes/aanvragen/index';
import { toDay } from 'frontend-organization-portal/controllers/aanvragen/index';

module('Unit | Route | aanvragen/index', function (hooks) {
  setupTest(hooks);

  test('the period filter covers whole days in local time, and an empty or invalid day is no bound', function (assert) {
    const from = new Date(startOfDay('2026-10-20'));
    const until = new Date(endOfDay('2026-10-20'));
    assert.deepEqual(
      [from.getHours(), from.getMinutes(), from.getDate()],
      [0, 0, 20],
    );
    assert.deepEqual(
      [
        until.getHours(),
        until.getMinutes(),
        until.getSeconds(),
        until.getDate(),
      ],
      [23, 59, 59, 20],
    );
    assert.strictEqual(startOfDay(''), undefined);
    assert.strictEqual(endOfDay(undefined), undefined);
    assert.strictEqual(startOfDay('niet-een-datum'), undefined);
  });

  test('a picked date becomes the day of the query parameter', function (assert) {
    assert.strictEqual(toDay(new Date(2026, 9, 3)), '2026-10-03');
    assert.strictEqual(
      toDay(new Date('2026-10-03')),
      '2026-10-03',
      'the date picker gives midnight UTC, the evening before west of UTC',
    );
    assert.strictEqual(toDay(null), '');
    assert.strictEqual(toDay(new Date('x')), '');
  });

  test('the route exists', function (assert) {
    assert.ok(this.owner.lookup('route:aanvragen/index'));
    assert.ok(this.owner.lookup('route:aanvragen/aanvraag'));
    assert.ok(this.owner.lookup('route:aanvragen'));
  });
});
