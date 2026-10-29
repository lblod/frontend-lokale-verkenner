import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';

module('Unit | Route | mijn-organisatie', function (hooks) {
  setupTest(hooks);

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('it lands a logged-in user on the kerngegevens of their organisation, or on the unauthorized page without one', function (assert) {
    const route = this.owner.lookup('route:mijn-organisatie');
    const session = this.owner.lookup('service:session');
    const requireAuthentication = sinon
      .stub(session, 'requireAuthentication')
      .returns(true);
    const replaceWith = sinon.stub(
      this.owner.lookup('service:router'),
      'replaceWith',
    );
    const currentSession = this.owner.lookup('service:current-session');
    const organizationId = sinon.stub(currentSession, 'organizationId');

    organizationId.get(() => 'org-1');
    route.beforeModel({});
    assert.true(
      replaceWith.calledOnceWithExactly(
        'organizations.organization.core-data',
        'org-1',
      ),
    );

    replaceWith.resetHistory();
    organizationId.get(() => undefined);
    route.beforeModel({});
    assert.true(replaceWith.calledOnceWithExactly('unauthorized'));

    // Not logged in: `requireAuthentication` sends the visitor to the login
    // page, and nothing may take them elsewhere
    replaceWith.resetHistory();
    requireAuthentication.returns(false);
    route.beforeModel({});
    assert.true(replaceWith.notCalled);
  });

  test('the request pages send a visitor who is not logged in to the login page only', async function (assert) {
    const route = this.owner.lookup('route:aanvragen');
    sinon
      .stub(this.owner.lookup('service:session'), 'requireAuthentication')
      .returns(false);
    const transitionTo = sinon.stub(
      this.owner.lookup('service:router'),
      'transitionTo',
    );

    await route.beforeModel({});

    assert.true(
      transitionTo.notCalled,
      'not to the start page, although no role is active',
    );
  });
});
