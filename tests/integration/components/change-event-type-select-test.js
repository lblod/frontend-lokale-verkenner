import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { click, render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';

module('Integration | Component | change-event-type-select', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    const store = this.owner.lookup('service:store');
    this.classification = store.push({
      data: {
        type: 'administrative-unit-classification-code',
        id: CLASSIFICATION.MUNICIPALITY.id,
        attributes: { label: 'Gemeente' },
      },
    });
    const types = [
      [CHANGE_EVENT_TYPE.NAME_CHANGE, 'Naamswijziging'],
      [CHANGE_EVENT_TYPE.OPRICHTING, 'Oprichting'],
      [CHANGE_EVENT_TYPE.CITY, 'Stadstitel'],
      [CHANGE_EVENT_TYPE.FUSIE, 'Fusie'],
      [CHANGE_EVENT_TYPE.RECOGNITION_GRANTED, 'Erkenning toegekend'],
    ];
    sinon.stub(store, 'request').resolves({
      content: types.map(([id, label]) =>
        store.push({
          data: { type: 'change-event-type', id, attributes: { label } },
        }),
      ),
    });
    this.onChange = sinon.stub();
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  async function options() {
    await click('.ember-power-select-trigger');

    return Array.from(
      document.querySelectorAll('.ember-power-select-option'),
      (option) => option.textContent.trim(),
    );
  }

  test('it offers the types of the organisation type, without the worship-only ones', async function (assert) {
    await render(hbs`
      <ChangeEventTypeSelect
        @id="change-event-type"
        @organizationClassification={{this.classification}}
        @onChange={{this.onChange}}
      />
    `);

    assert.deepEqual(await options(), [
      'Naamswijziging',
      'Oprichting',
      'Stadstitel',
    ]);
  });

  test('it leaves out the types the caller excludes', async function (assert) {
    this.excluded = [CHANGE_EVENT_TYPE.CITY, CHANGE_EVENT_TYPE.FUSIE];

    await render(hbs`
      <ChangeEventTypeSelect
        @id="change-event-type"
        @organizationClassification={{this.classification}}
        @excludeIds={{this.excluded}}
        @onChange={{this.onChange}}
      />
    `);

    assert.deepEqual(await options(), ['Naamswijziging', 'Oprichting']);
  });
});
