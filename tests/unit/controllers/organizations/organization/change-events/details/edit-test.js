/* eslint-disable warp-drive/no-legacy-request-patterns -- TODO: remove this once we have an alternative for peekRecord */
import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import EditController from 'frontend-organization-portal/controllers/organizations/organization/change-events/details/edit';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

const REQUEST_ID = 'b3f1f4e2-5f4e-4c39-9a5e-6f7b0d2a1c48';

const event = { preventDefault() {} };

module(
  'Unit | Controller | organizations/organization/change-events/details/edit',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are a lazy bundle, so register the controller first.
    hooks.beforeEach(function () {
      this.owner.register(
        'controller:organizations/organization/change-events/details/edit',
        EditController,
      );
      this.store = this.owner.lookup('service:store');
      this.controller = this.owner.lookup(
        'controller:organizations/organization/change-events/details/edit',
      );
      const changeRequests = this.owner.lookup('service:change-requests');
      this.submit = sinon.stub(changeRequests, 'submit');
      const router = this.owner.lookup('service:router');
      this.refresh = sinon.stub(router, 'refresh');
      this.transitionTo = sinon.stub(router, 'transitionTo');
      this.warning = sinon.stub(
        this.owner.lookup('service:toaster'),
        'warning',
      );
      // No later change event for the organisation.
      this.request = sinon
        .stub(this.store, 'request')
        .resolves({ content: [] });
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    // A persisted name-change event with its result, besluit and activity.
    function pushPage(store) {
      store.push({
        data: [
          {
            type: 'administrative-unit',
            id: 'org-1',
            attributes: { name: 'Stad Aalst', legalName: 'Stad Aalst' },
          },
          {
            type: 'change-event-type',
            id: CHANGE_EVENT_TYPE.NAME_CHANGE,
            attributes: { label: 'Naamswijziging' },
          },
          {
            type: 'change-event',
            id: 'event-1',
            attributes: {
              date: '2025-01-01',
              description: 'Oude beschrijving',
            },
            relationships: {
              type: {
                data: {
                  type: 'change-event-type',
                  id: CHANGE_EVENT_TYPE.NAME_CHANGE,
                },
              },
              decision: { data: { type: 'decision', id: 'decision-1' } },
              'original-organizations': {
                data: [{ type: 'administrative-unit', id: 'org-1' }],
              },
              results: {
                data: [{ type: 'change-event-result', id: 'result-1' }],
              },
            },
          },
          {
            type: 'change-event-result',
            id: 'result-1',
            attributes: { originalName: 'Aalst', resultingName: 'Stad Aalst' },
            relationships: {
              'result-from': {
                data: { type: 'change-event', id: 'event-1' },
              },
            },
          },
          {
            type: 'decision',
            id: 'decision-1',
            attributes: {
              publicationDate: '2025-01-02',
              documentLinks: ['https://aalst.be/besluit'],
            },
            relationships: {
              'has-decision-activity': {
                data: { type: 'decision-activity', id: 'activity-1' },
              },
            },
          },
          {
            type: 'decision-activity',
            id: 'activity-1',
            attributes: { endDate: '2025-02-01' },
            relationships: {
              'gives-cause-to': {
                data: [{ type: 'decision', id: 'decision-1' }],
              },
            },
          },
        ],
      });

      return {
        organization: store.peekRecord('administrative-unit', 'org-1'),
        changeEvent: store.peekRecord('change-event', 'event-1'),
        currentChangeEventResult: store.peekRecord(
          'change-event-result',
          'result-1',
        ),
        decision: store.peekRecord('decision', 'decision-1'),
        decisionActivity: store.peekRecord('decision-activity', 'activity-1'),
      };
    }

    this.setupPage = function (page) {
      this.controller.model = page;
    };

    test('it submits a changed description as one request, the besluit before the event', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      this.submit.resolves(new Map());

      page.changeEvent.description = 'Nieuwe beschrijving';

      await this.controller.save.perform(event);

      assert.true(this.submit.calledOnce);
      const [aggregate, target, records] = this.submit.firstCall.args;
      assert.strictEqual(aggregate, 'change-event-edit');
      assert.strictEqual(target, 'org-1');
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        ['decision', 'change-event'],
        'the besluit before the event, no result or organisation change',
      );
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.change-events.details',
          'event-1',
        ),
      );
    });

    test('it links a new besluit and its activity from the forward side, the activity after the besluit', async function (assert) {
      const page = pushPage(this.store);
      const decision = this.store.createRecord('decision', {
        documentLinks: ['https://aalst.be/besluit'],
      });
      const decisionActivity = this.store.createRecord('decision-activity', {
        endDate: new Date('2025-03-01'),
      });
      this.setupPage({ ...page, decision, decisionActivity });
      this.submit.resolves(new Map());

      page.changeEvent.description = 'Nieuwe beschrijving';

      await this.controller.save.perform(event);

      assert.true(this.submit.calledOnce);
      const records = this.submit.firstCall.args[2];
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        ['decision', 'decision-activity', 'change-event'],
      );
      assert.strictEqual(
        page.changeEvent.belongsTo('decision').value(),
        decision,
        'the event links the besluit on its own side',
      );
      assert.deepEqual(
        (await decisionActivity.givesCauseTo).map((record) => record.id),
        [decision.id],
        'the activity links the besluit on its own side',
      );
    });

    test('it deletes the besluit the user cleared', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      this.submit.resolves(new Map());

      page.decision.documentLinks = [];
      page.decision.publicationDate = null;

      await this.controller.save.perform(event);

      assert.true(this.submit.calledOnce);
      const records = this.submit.firstCall.args[2];
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        ['decision', 'change-event'],
      );
      assert.true(page.decision.isDeleted);
      assert.strictEqual(page.changeEvent.belongsTo('decision').value(), null);
    });

    test('it sends the corrected name and the organisation it follows for the most recent event', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      this.submit.resolves(new Map());

      page.currentChangeEventResult.resultingName = 'Stad Aalst (nieuw)';

      await this.controller.save.perform(event);

      assert.true(this.submit.calledOnce);
      const records = this.submit.firstCall.args[2];
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        [
          'decision',
          'change-event',
          'change-event-result',
          'administrative-unit',
        ],
        'the result before the organisation, the organisation last',
      );
      assert.strictEqual(page.organization.name, 'Stad Aalst (nieuw)');
      assert.strictEqual(page.organization.legalName, 'Stad Aalst (nieuw)');
    });

    test('it does not touch the organisation for an event a later one follows', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      this.submit.resolves(new Map());
      this.store.push({
        data: [
          {
            type: 'change-event',
            id: 'event-2',
            attributes: { date: '2026-01-01' },
            relationships: {
              type: {
                data: {
                  type: 'change-event-type',
                  id: CHANGE_EVENT_TYPE.NAME_CHANGE,
                },
              },
              results: {
                data: [{ type: 'change-event-result', id: 'result-2' }],
              },
            },
          },
          {
            type: 'change-event-result',
            id: 'result-2',
            relationships: {
              'result-from': { data: { type: 'change-event', id: 'event-2' } },
            },
          },
        ],
      });
      const laterResult = this.store.peekRecord(
        'change-event-result',
        'result-2',
      );
      this.request.resolves({ content: [laterResult] });

      page.currentChangeEventResult.resultingName = 'Stad Aalst (nieuw)';

      await this.controller.save.perform(event);

      assert.true(this.submit.calledOnce);
      const records = this.submit.firstCall.args[2];
      assert.notOk(
        records.includes(page.organization),
        'the organisation of an older event is left alone',
      );
      assert.strictEqual(page.organization.name, 'Stad Aalst');
    });

    test('it does not submit a name change without a new name, nor the same name as the original', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);

      page.currentChangeEventResult.resultingName = null;
      await this.controller.save.perform(event);

      assert.true(this.submit.notCalled);
      assert.ok(
        page.changeEvent.error.resultingName,
        'the new name is required',
      );

      page.changeEvent.resetErrors();
      page.currentChangeEventResult.resultingName = 'Aalst';
      await this.controller.save.perform(event);

      assert.true(this.submit.notCalled);
      assert.ok(
        page.changeEvent.error.resultingName,
        'the new name differs from the original',
      );
    });

    test('it does not send a request when nothing changed', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);

      await this.controller.save.perform(event);

      assert.true(this.submit.notCalled);
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.change-events.details',
          'event-1',
        ),
      );
    });

    test('it reloads the page and shows the notice when the service holds the request', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      const revision = this.controller.formRevision;
      this.submit.rejects(
        new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
          status: 409,
          held: true,
          waiting: false,
          requestId: null,
          conflicts: [
            {
              resource: { type: 'change-events', id: 'event-1' },
              key: 'description',
              base: 'Oude beschrijving',
              current: 'Andere beschrijving',
              proposed: 'Nieuwe beschrijving',
              'competing-requests': [],
            },
          ],
        }),
      );
      // Refreshing resets the controller, as the edit route's resetController does.
      this.refresh.callsFake(async () => {
        this.controller.reset();
        assert.strictEqual(this.controller.formRevision, revision);
      });

      page.changeEvent.description = 'Nieuwe beschrijving';

      await this.controller.save.perform(event);

      assert.true(
        this.refresh.calledOnceWithExactly(
          'organizations.organization.change-events.details',
        ),
      );
      assert.strictEqual(this.controller.formRevision, revision + 1);
      assert.deepEqual(this.controller.heldRequest, {
        id: null,
        fields: ['Beschrijving'],
        reloadFailed: false,
        waiting: false,
      });
      assert.true(this.transitionTo.notCalled);
      assert.strictEqual(this.controller.saveError, null);
      assert.false(this.controller.saveBlocked);
    });

    test('it blocks saving and keeps the request to link to when its apply failed', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet doorgevoerd worden.', {
          status: 409,
          applyFailed: true,
          requestId: REQUEST_ID,
        }),
      );

      page.changeEvent.description = 'Nieuwe beschrijving';

      await this.controller.save.perform(event);

      assert.true(this.controller.saveBlocked);
      assert.strictEqual(this.controller.failedRequestId, REQUEST_ID);

      await this.controller.save.perform(event);

      assert.true(this.submit.calledOnce, 'a second save sends nothing');
    });

    test('it shows the message of the service and keeps the edits when the request is refused', async function (assert) {
      const page = pushPage(this.store);
      this.setupPage(page);
      this.submit.rejects(
        new ChangeRequestError('U mag deze organisatie niet bewerken.', {
          status: 403,
        }),
      );

      page.changeEvent.description = 'Nieuwe beschrijving';

      await this.controller.save.perform(event);

      assert.strictEqual(
        this.controller.saveError,
        'U mag deze organisatie niet bewerken.',
      );
      assert.strictEqual(this.controller.heldRequest, null);
      assert.false(this.controller.saveBlocked);
      assert.true(this.refresh.notCalled);
      assert.true(this.transitionTo.notCalled);
    });
  },
);
