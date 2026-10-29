import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import IndexRoute from 'frontend-organization-portal/routes/organizations/organization/change-events/index';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

module(
  'Unit | Route | organizations/organization/change-events/index',
  function (hooks) {
    setupTest(hooks);

    hooks.beforeEach(function () {
      this.owner.register(
        'route:organizations/organization/change-events/index',
        IndexRoute,
      );
      this.route = this.owner.lookup(
        'route:organizations/organization/change-events/index',
      );
      this.changeRequests = this.owner.lookup('service:change-requests');
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('the requests that are not applied yet, rejected ones included, come with the type and date of their event and whether they wait', async function (assert) {
      const list = sinon.stub(this.changeRequests, 'list').resolves({
        requests: [
          { id: 'cr-1', attributes: { status: 'afgekeurd' } },
          { id: 'cr-2', attributes: { status: 'ingediend' } },
        ],
        count: 2,
      });
      sinon.stub(this.changeRequests, 'find').callsFake(async (id) => {
        if (id === 'cr-2') {
          throw new ChangeRequestError('Niet gevonden.', { status: 404 });
        }
        return {
          id,
          attributes: {
            operations: [
              {
                op: 'create',
                data: {
                  type: 'change-events',
                  id: 'event-1',
                  attributes: { date: '2026-10-01' },
                  relationships: {
                    type: {
                      data: { type: 'change-event-types', id: 'type-1' },
                    },
                  },
                },
              },
            ],
          },
        };
      });
      sinon
        .stub(this.owner.lookup('adapter:application'), 'findRecord')
        .resolves({
          data: {
            type: 'change-event-types',
            id: 'type-1',
            attributes: { label: 'Naamswijziging' },
          },
        });

      const pending = await this.route.loadPendingRequests('org-1');

      assert.strictEqual(
        list.firstCall.args[0].status,
        'ingediend,informatie-gevraagd,afgekeurd',
      );
      assert.strictEqual(list.firstCall.args[0].kind, 'change-event');
      assert.strictEqual(pending[0].eventDate, '2026-10-01');
      assert.strictEqual(pending[0].eventType.label, 'Naamswijziging');
      assert.deepEqual(
        [pending[1].request.id, pending[1].eventType, pending[1].eventDate],
        ['cr-2', null, null],
        'a request that cannot be read is shown without its event',
      );
      assert.deepEqual(
        pending.map(({ waiting }) => waiting),
        [false, true],
        'a rejected request no longer waits',
      );
    });
  },
);
