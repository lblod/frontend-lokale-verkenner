import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import EditRoute from 'frontend-organization-portal/routes/organizations/organization/sites/site/edit';

module(
  'Unit | Route | organizations/organization/sites/site/edit',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are built into a lazy bundle (`splitAtRoutes`
    // in ember-cli-build.js), so the route must be registered before the
    // owner can look it up.
    hooks.beforeEach(function () {
      this.owner.register(
        'route:organizations/organization/sites/site/edit',
        EditRoute,
      );
      this.route = this.owner.lookup(
        'route:organizations/organization/sites/site/edit',
      );
      this.store = this.owner.lookup('service:store');
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('it reloads the sites of the organisation, which a change of the primary site starts from', async function (assert) {
      const [organization, site] = this.store.push({
        data: [
          {
            type: 'organization',
            id: 'org-1',
            attributes: { name: 'Gemeente Test' },
            relationships: {
              primarySite: { data: { type: 'site', id: 'site-1' } },
              sites: { data: [] },
            },
          },
          {
            type: 'site',
            id: 'site-1',
            relationships: {
              address: { data: null },
              contacts: { data: [] },
            },
          },
        ],
      });
      sinon
        .stub(this.route, 'modelFor')
        .callsFake((name) =>
          name === 'organizations.organization' ? organization : { site },
        );
      // Someone else made another site primary since the store loaded the
      // organisation
      const reload = sinon
        .stub(this.owner.lookup('adapter:application'), 'findRecord')
        .callsFake((store, schema, id) =>
          Promise.resolve({
            data: {
              type: 'organizations',
              id,
              attributes: { name: 'Gemeente Test' },
              relationships: {
                'primary-site': { data: { type: 'sites', id: 'site-2' } },
                sites: { data: [{ type: 'sites', id: 'site-1' }] },
              },
            },
            included: [{ type: 'sites', id: 'site-2', attributes: {} }],
          }),
        );

      const model = await this.route.model();

      assert.true(reload.calledOnce);
      const [, schema, id, snapshot] = reload.firstCall.args;
      assert.strictEqual(schema.modelName, 'organization');
      assert.strictEqual(id, 'org-1');
      assert.strictEqual(snapshot.include, 'primary-site,sites');
      assert.strictEqual(model.organization, organization);
      assert.strictEqual(
        model.currentPrimarySite.id,
        'site-2',
        'the primary site as it is now',
      );
      assert.deepEqual(organization.hasMany('sites').ids(), ['site-1']);
    });
  },
);
