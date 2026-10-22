import { module, test } from 'qunit';
import { setupTest } from 'frontend-organization-portal/tests/helpers';

module('Unit | Serializer | decision-activity', function (hooks) {
  setupTest(hooks);

  test('it writes the decisions an activity gives cause to: the backend keeps the link on the activity', function (assert) {
    const store = this.owner.lookup('service:store');
    const [decision] = store.push({
      data: [{ type: 'decision', id: 'decision-1' }],
    });
    const activity = store.createRecord('decision-activity', {
      endDate: new Date(2026, 9, 1),
      givesCauseTo: [decision],
    });

    const { data } = this.owner
      .lookup('serializer:decision-activity')
      .serialize(activity._createSnapshot(), {});

    assert.deepEqual(data.relationships['gives-cause-to'], {
      data: [{ type: 'decisions', id: 'decision-1' }],
    });
  });
});
