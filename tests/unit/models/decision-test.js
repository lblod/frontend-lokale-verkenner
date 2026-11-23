import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';

module('Unit | Model | decision', function (hooks) {
  setupTest(hooks);

  this.store = function () {
    return this.owner.lookup('service:store');
  };

  test('it returns no errors when the model is empty', async function (assert) {
    const model = this.store().createRecord('decision');

    const isValid = await model.validate();

    assert.true(isValid);
  });

  test('it returns an error on an invalid url', async function (assert) {
    const model = this.store().createRecord('decision', {
      documentLinks: ['https://www.vlaanderen.be', 'Invalid url'],
    });

    const isValid = await model.validate();

    assert.false(isValid);
    assert.strictEqual(Object.keys(model.error).length, 1);
    assert.propContains(model.error, {
      documentLinks: {
        1: { message: 'Geef een geldig internetadres in' },
      },
    });
  });

  test('it returns no error when a valid url is provided', async function (assert) {
    const model = this.store().createRecord('decision', {
      documentLinks: ['https://www.vlaanderen.be'],
    });

    const isValid = await model.validate();

    assert.true(isValid);
  });

  test('it returns no error when no urls were provided', async function (assert) {
    const model = this.store().createRecord('decision', {
      documentLinks: [],
    });

    const isValid = await model.validate();

    assert.true(isValid);
  });

  test('it is empty when all document links are empty', function (assert) {
    const model = this.store().createRecord('decision', {
      documentLinks: ['', ''],
    });

    assert.true(model.isEmpty);
  });

  test('it is not empty when a document link is provided', function (assert) {
    const model = this.store().createRecord('decision', {
      documentLinks: ['https://www.vlaanderen.be'],
    });

    assert.false(model.isEmpty);
  });

  test('it is empty without links, text or no-link message', function (assert) {
    const model = this.store().createRecord('decision', {
      documentLinks: [],
      description: '  ',
      geenLinkBeschikbaar: '',
    });

    assert.true(model.isEmpty);
  });

  test('a decision with a text only is not empty and validates', async function (assert) {
    const model = this.store().createRecord('decision', {
      description: 'Besluit van de gemeenteraad van 1 oktober 2026',
    });

    assert.false(model.isEmpty);
    assert.true(await model.validate());
    assert.strictEqual(model.error, undefined);
  });

  test('a decision with a no-link message only is not empty and validates', async function (assert) {
    const model = this.store().createRecord('decision', {
      geenLinkBeschikbaar: 'Het besluit is niet online beschikbaar.',
    });

    assert.false(model.isEmpty);
    assert.true(await model.validate());
    assert.strictEqual(model.error, undefined);
  });
});
