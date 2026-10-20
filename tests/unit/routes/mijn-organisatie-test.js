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
    sinon.stub(session, 'requireAuthentication');
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
  });
});
