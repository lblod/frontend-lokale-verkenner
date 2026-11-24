import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import EditRoute from 'frontend-organization-portal/routes/organizations/organization/change-events/details/edit';

module(
  'Unit | Route | organizations/organization/change-events/details/edit',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are a lazy bundle, so register the route first.
    hooks.beforeEach(function () {
      this.owner.register(
        'route:organizations/organization/change-events/details/edit',
        EditRoute,
      );
      this.transitionTo = sinon.stub(
        this.owner.lookup('service:router'),
        'transitionTo',
      );
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    this.route = function () {
      return this.owner.lookup(
        'route:organizations/organization/change-events/details/edit',
      );
    };

    test('it opens for a session that may edit the organisation', function (assert) {
      const changeRequests = this.owner.lookup('service:change-requests');
      sinon
        .stub(changeRequests, 'canEditOrganization')
        .withArgs('org-1')
        .returns(true);
      const route = this.route();
      sinon
        .stub(route, 'paramsFor')
        .withArgs('organizations.organization')
        .returns({ id: 'org-1' });

      route.beforeModel();

      assert.true(this.transitionTo.notCalled);
    });

    test('it sends a session that may not edit the organisation to the unauthorized page', function (assert) {
      const changeRequests = this.owner.lookup('service:change-requests');
      sinon.stub(changeRequests, 'canEditOrganization').returns(false);
      const route = this.route();
      sinon
        .stub(route, 'paramsFor')
        .withArgs('organizations.organization')
        .returns({ id: 'org-1' });

      route.beforeModel();

      assert.true(this.transitionTo.calledOnceWithExactly('unauthorized'));
    });
  },
);
