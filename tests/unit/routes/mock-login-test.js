import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import MockLoginRoute from 'frontend-organization-portal/routes/mock-login';

module('Unit | Route | mock-login', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    // a split route (ember-cli-build.js): registered here, as the app loads it lazily
    this.owner.register('route:mock-login', MockLoginRoute);
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('it finds the mock accounts by the names of their person, which a visitor without a session may read', async function (assert) {
    const route = this.owner.lookup('route:mock-login');
    const request = sinon
      .stub(this.owner.lookup('service:store'), 'request')
      .resolves({ content: [] });

    await route.model({ organisatie: 'Aalst', page: 0 });

    // The query builder hands the store the query hash under data.query
    const { type, query } = request.firstCall.args[0].data;
    assert.strictEqual(type, 'account');
    assert.strictEqual(query.filter.user, 'Aalst');
    assert.strictEqual(query.include, 'user.organizations');
  });
});
