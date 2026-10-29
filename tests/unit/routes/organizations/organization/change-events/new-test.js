import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import NewRoute from 'frontend-organization-portal/routes/organizations/organization/change-events/new';

module(
  'Unit | Route | organizations/organization/change-events/new',
  function (hooks) {
    setupTest(hooks);

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('it loads the fields an event may change before the form changes them', async function (assert) {
      // The organizations routes are built into a lazy bundle
      this.owner.register(
        'route:organizations/organization/change-events/new',
        NewRoute,
      );
      const route = this.owner.lookup(
        'route:organizations/organization/change-events/new',
      );
      const store = this.owner.lookup('service:store');
      // As the organisation route loads it: the status included, the rest
      // as links
      const organization = store.push({
        data: {
          type: 'administrative-unit',
          id: 'org-1',
          attributes: { name: 'Aalst' },
          relationships: {
            organizationStatus: {
              data: { type: 'organization-status-code', id: 'status-1' },
            },
            legalForm: {
              links: { related: '/administrative-units/org-1/legal-form' },
            },
            scope: {
              links: { related: '/administrative-units/org-1/scope' },
            },
            additionalQualifications: {
              links: {
                related:
                  '/administrative-units/org-1/additional-qualifications',
              },
            },
          },
        },
        included: [{ type: 'organization-status-code', id: 'status-1' }],
      });
      sinon.stub(route, 'modelFor').returns(organization);
      const adapter = this.owner.lookup('adapter:application');
      const findBelongsTo = sinon
        .stub(adapter, 'findBelongsTo')
        .callsFake(async (store, snapshot, url) => ({
          data: url.endsWith('/scope')
            ? { type: 'locations', id: 'location-1' }
            : { type: 'concepts', id: 'legal-form-1' },
        }));
      const findHasMany = sinon.stub(adapter, 'findHasMany').resolves({
        data: [
          { type: 'additional-qualification-codes', id: 'qualification-1' },
        ],
      });

      const model = await route.model();

      assert.deepEqual(
        findBelongsTo
          .getCalls()
          .map(({ args }) => args[2])
          .sort(),
        [
          '/administrative-units/org-1/legal-form',
          '/administrative-units/org-1/scope',
        ],
      );
      assert.true(findHasMany.calledOnce);
      assert.strictEqual(
        organization.belongsTo('legalForm').value()?.id,
        'legal-form-1',
      );
      assert.deepEqual(
        organization.additionalQualifications.map(({ id }) => id),
        ['qualification-1'],
      );
      assert.strictEqual(model.organization, organization);
      assert.true(model.changeEvent.isNew);
    });
  },
);
