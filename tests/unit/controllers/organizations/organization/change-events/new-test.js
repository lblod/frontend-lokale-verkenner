import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import NewController from 'frontend-organization-portal/controllers/organizations/organization/change-events/new';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';
import { ORGANIZATION_STATUS } from 'frontend-organization-portal/models/organization-status-code';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';

const REQUEST_ID = '25e29be4-7c4e-4044-9357-2196fa23a17e';

module(
  'Unit | Controller | organizations/organization/change-events/new',
  function (hooks) {
    setupTest(hooks);

    hooks.beforeEach(function () {
      // The organizations routes are built into a lazy bundle, so the
      // controller must be registered before the owner can look it up
      this.owner.register(
        'controller:organizations/organization/change-events/new',
        NewController,
      );
      this.store = this.owner.lookup('service:store');
      this.controller = this.owner.lookup(
        'controller:organizations/organization/change-events/new',
      );
      this.changeRequests = this.owner.lookup('service:change-requests');
      this.changeRequests.rights = { canDecide: false, canCreate: [] };
      this.submit = sinon.stub(this.changeRequests, 'submit');
      this.replaceWith = sinon.stub(
        this.owner.lookup('service:router'),
        'replaceWith',
      );
      this.success = sinon.stub(
        this.owner.lookup('service:toaster'),
        'success',
      );
      const adapter = this.owner.lookup('adapter:application');
      // The most recent change event of the organisation: none
      sinon.stub(adapter, 'query').resolves({ data: [] });
      // The resulting status code
      sinon.stub(adapter, 'findRecord').callsFake(async (store, type, id) => ({
        data: {
          type: 'organization-status-codes',
          id,
          attributes: {
            label: id === ORGANIZATION_STATUS.INACTIVE ? 'Niet actief' : 'Actief',
          },
        },
      }));
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    /**
     * The form as the route sets it up: an active gemeente and a new event
     * of the given type.
     */
    function setupForm(store, controller, typeId, { date = new Date(2026, 9, 1) } = {}) {
      const [classification, status, type] = store.push({
        data: [
          {
            type: 'administrative-unit-classification-code',
            id: CLASSIFICATION.MUNICIPALITY.id,
            attributes: { label: 'Gemeente' },
          },
          {
            type: 'organization-status-code',
            id: ORGANIZATION_STATUS.ACTIVE,
            attributes: { label: 'Actief' },
          },
          {
            type: 'change-event-type',
            id: typeId,
            attributes: { label: 'Type' },
          },
        ],
      });
      const organization = store.push({
        data: {
          type: 'administrative-unit',
          id: 'org-1',
          attributes: { name: 'Aalst', legalName: 'Aalst' },
          relationships: {
            classification: {
              data: {
                type: 'administrative-unit-classification-code',
                id: classification.id,
              },
            },
            'organization-status': {
              data: { type: 'organization-status-code', id: status.id },
            },
          },
        },
      });
      const changeEvent = store.createRecord('change-event', {
        type,
        date,
        originalOrganizations: [organization],
      });
      const decision = store.createRecord('decision');
      controller.set('model', { organization, changeEvent, decision });
      return { organization, changeEvent, decision, status };
    }

    test('it leaves the multi-organisation types out and names the button after who submits', function (assert) {
      const { controller } = this;
      assert.true(controller.excludedTypeIds.includes(CHANGE_EVENT_TYPE.FUSIE));
      assert.true(controller.excludedTypeIds.includes(CHANGE_EVENT_TYPE.MERGER));
      assert.strictEqual(controller.submitLabel, 'Aanvraag versturen');

      this.changeRequests.rights = { canDecide: true, canCreate: [] };
      assert.true(controller.appliesAtOnce);
      assert.strictEqual(controller.submitLabel, 'Opslaan');
    });

    test('it does not submit without a type and a date, nor a name change without the new name', async function (assert) {
      const { controller } = this;
      const { changeEvent } = setupForm(this.store, controller, CHANGE_EVENT_TYPE.NAME_CHANGE, { date: null });
      changeEvent.type = null;

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.true(this.submit.notCalled);
      assert.ok(changeEvent.error.type, 'the type is required');
      assert.ok(changeEvent.error.date, 'the date is required');

      const form = setupForm(this.store, controller, CHANGE_EVENT_TYPE.NAME_CHANGE);
      await controller.submitRequestTask.perform({ preventDefault() {} });
      assert.true(this.submit.notCalled);
      assert.ok(form.changeEvent.error.resultingName, 'the new name is required');
    });

    test('a naamswijziging submits the event, its result and the renamed organisation as one request about the organisation, and goes to the request when it waits', async function (assert) {
      const { controller } = this;
      const { organization, changeEvent, decision } = setupForm(this.store, controller, CHANGE_EVENT_TYPE.NAME_CHANGE);
      controller.resultingName = 'Stad Aalst';
      controller.reason = 'Besluit van de gemeenteraad';
      decision.documentLinks = ['https://aalst.be/besluiten/2026/124', ' '];
      this.submit.rejects(
        new ChangeRequestError('De aanvraag wacht op ABB.', {
          status: 201,
          held: true,
          waiting: true,
          requestId: REQUEST_ID,
        }),
      );

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.false(controller.hasValidationErrors);
      assert.true(this.submit.calledOnce);
      const [aggregate, target, records, options] = this.submit.firstCall.args;
      assert.strictEqual(aggregate, 'change-event');
      assert.strictEqual(target, 'org-1', 'the request is about the organisation');
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        ['decision', 'change-event', 'change-event-result', 'administrative-unit'],
      );
      assert.deepEqual(options, { reason: 'Besluit van de gemeenteraad' });
      assert.deepEqual(decision.documentLinks, ['https://aalst.be/besluiten/2026/124'], 'empty links are dropped');
      assert.strictEqual((await changeEvent.decision)?.id, decision.id);
      const result = records[2];
      assert.strictEqual(result.resultingName, 'Stad Aalst');
      assert.strictEqual((await result.status)?.id, ORGANIZATION_STATUS.ACTIVE);
      assert.strictEqual((await result.resultingOrganization)?.id, 'org-1');
      assert.strictEqual(organization.legalName, 'Stad Aalst', 'the organisation carries the new name');
      assert.deepEqual((await changeEvent.resultingOrganizations).map((o) => o.id), ['org-1']);
      assert.true(this.success.calledOnce);
      assert.true(this.replaceWith.calledOnceWithExactly('aanvragen.aanvraag', REQUEST_ID));
    });

    test('an ontbinding sets the organisation inactive; ABB sees the event at once', async function (assert) {
      const { controller } = this;
      this.changeRequests.rights = { canDecide: true, canCreate: [] };
      const { organization, changeEvent } = setupForm(this.store, controller, CHANGE_EVENT_TYPE.ONTBONDEN_EN_VEREFFEND);
      this.submit.resolves(new Map([[changeEvent, { id: 'event-1' }]]));

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.strictEqual((await organization.organizationStatus)?.id, ORGANIZATION_STATUS.INACTIVE);
      const records = this.submit.firstCall.args[2];
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        ['change-event', 'change-event-result', 'administrative-unit'],
        'no decision without links or date',
      );
      assert.true(this.replaceWith.calledOnceWithExactly('organizations.organization.change-events.details', 'event-1'));
      assert.true(this.success.notCalled);
    });

    test('a refusal keeps the form and shows the message; cancelling drops the local changes', async function (assert) {
      const { controller } = this;
      const { organization, changeEvent } = setupForm(this.store, controller, CHANGE_EVENT_TYPE.NAME_CHANGE);
      controller.resultingName = 'Stad Aalst';
      this.submit.rejects(new ChangeRequestError('Je mag deze organisatie niet bewerken.', { status: 403 }));

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.strictEqual(controller.saveError, 'Je mag deze organisatie niet bewerken.');
      assert.true(this.replaceWith.notCalled);
      assert.strictEqual(organization.legalName, 'Stad Aalst', 'the local change is still there');

      controller.reset();

      assert.strictEqual(organization.legalName, 'Aalst', 'rolled back');
      assert.true(changeEvent.isDestroying, 'the new event is dropped');
      assert.strictEqual(controller.saveError, null);
    });
  },
);
