/* eslint-disable warp-drive/no-legacy-request-patterns -- TODO: remove this once we have an alternative for peekRecord and peekAll */
import { module, test } from 'qunit';
import { settled } from '@ember/test-helpers';
import { saveRecord } from '@warp-drive/legacy/compat/builders';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import EditController from 'frontend-organization-portal/controllers/organizations/organization/related-organizations/edit';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { isEmptyPeriod } from 'frontend-organization-portal/utils/period-of-time';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { MEMBERSHIP_ROLES_MAPPING } from 'frontend-organization-portal/models/membership-role';
import OrganizationModel from 'frontend-organization-portal/models/organization';

// A change request the service kept.
const REQUEST_ID = 'e78ecf96-3a00-406f-a356-30cf560d7dba';

module(
  'Unit | Controller | organizations/organization/related-organizations/edit',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are a lazy bundle, so register the controller first.
    hooks.beforeEach(function () {
      this.owner.register(
        'controller:organizations/organization/related-organizations/edit',
        EditController,
      );
      const router = this.owner.lookup('service:router');
      this.submit = sinon.stub(
        this.owner.lookup('service:change-requests'),
        'submit',
      );
      this.refresh = sinon.stub(router, 'refresh');
      this.transitionTo = sinon.stub(router, 'transitionTo');
      sinon.stub(this.owner.lookup('service:toaster'), 'warning');
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    this.store = function () {
      return this.owner.lookup('service:store');
    };

    this.controller = function () {
      return this.owner.lookup(
        'controller:organizations/organization/related-organizations/edit',
      );
    };

    /**
     * Push a persisted organization and a persisted membership with another
     * organization into the store, as the edit route would have loaded them.
     * When `period` is given, a persisted period with these dates is linked
     * to the membership.
     */
    function pushOrganizationWithMembership(store, { period } = {}) {
      store.push({
        data: [
          {
            type: 'organization',
            id: 'organization',
            attributes: { name: 'Organisatie' },
            relationships: {
              classification: {
                data: {
                  type: 'administrative-unit-classification-code',
                  id: CLASSIFICATION.MUNICIPALITY.id,
                },
              },
            },
          },
          {
            type: 'organization',
            id: 'member',
            attributes: { name: 'Lid' },
            relationships: {
              classification: {
                data: {
                  type: 'administrative-unit-classification-code',
                  id: CLASSIFICATION.MUNICIPALITY.id,
                },
              },
            },
          },
          {
            type: 'administrative-unit-classification-code',
            id: CLASSIFICATION.MUNICIPALITY.id,
            attributes: { label: CLASSIFICATION.MUNICIPALITY.label },
          },
          {
            type: 'membership-role',
            id: 'role',
            attributes: { label: 'Heeft een relatie met' },
          },
          {
            type: 'membership',
            id: 'membership',
            relationships: {
              organization: {
                data: { type: 'organization', id: 'organization' },
              },
              member: { data: { type: 'organization', id: 'member' } },
              role: { data: { type: 'membership-role', id: 'role' } },
              during: {
                data: period ? { type: 'period-of-time', id: 'period' } : null,
              },
            },
          },
          ...(period
            ? [{ type: 'period-of-time', id: 'period', attributes: period }]
            : []),
        ],
      });
      return {
        organization: store.peekRecord('organization', 'organization'),
        membership: store.peekRecord('membership', 'membership'),
      };
    }

    const event = { preventDefault() {} };

    module('reset', function () {
      test('it restores a persisted membership that was removed but not saved', function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.reallyRemoveMembership(membership);

        assert.true(membership.isDeleted);
        assert.true(membership.hasDirtyAttributes);
        assert.false(membership.isNew);
        assert.true(controller.hasUnsavedEdits);

        controller.reset();

        assert.false(membership.isDeleted);
        assert.false(membership.hasDirtyAttributes);
        assert.false(membership.isDestroying);
        assert.strictEqual(
          store.peekRecord('membership', 'membership'),
          membership,
        );
        assert.strictEqual(controller.memberships, null);

        // Opening the edit page again shows the membership
        controller.setup();

        assert.deepEqual(controller.memberships, [membership]);
        assert.false(controller.hasUnsavedEdits);
      });

      test('it unloads a new membership that was added but not saved', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.addMembership();
        const newMembership = controller.memberships.at(-1);

        assert.true(newMembership.isNew);
        assert.strictEqual(store.peekAll('membership').length, 2);

        controller.reset();

        assert.true(newMembership.isDestroying);
        assert.strictEqual(store.peekAll('membership').length, 1);
        assert.false(membership.isDeleted);

        await settled();

        assert.true(newMembership.isDestroyed);
      });

      test('it leaves a membership alone whose deletion was saved', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.reallyRemoveMembership(membership);
        // A successful DELETE returns no payload
        const deleteStub = sinon.stub(
          this.owner.lookup('adapter:application'),
          'deleteRecord',
        );
        deleteStub.resolves(null);
        await store.request(saveRecord(membership));

        assert.true(membership.isDeleted);
        assert.false(membership.hasDirtyAttributes);
        assert.false(membership.isDestroying);
        assert.strictEqual(store.peekAll('membership').length, 0);

        controller.reset();

        assert.true(membership.isDeleted);
        assert.false(membership.hasDirtyAttributes);
        assert.strictEqual(store.peekAll('membership').length, 0);
        assert.strictEqual(controller.memberships, null);

        deleteStub.restore();
      });

      test('it leaves memberships alone whose save is still in flight', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.reallyRemoveMembership(membership);
        controller.addMembership();
        const newMembership = controller.memberships.at(-1);

        // The adapter only answers when the test says so, as a slow server
        // would
        const adapter = this.owner.lookup('adapter:application');
        let resolveDelete;
        let resolveCreate;
        const deleteStub = sinon.stub(adapter, 'deleteRecord').returns(
          new Promise((resolve) => {
            resolveDelete = resolve;
          }),
        );
        const createStub = sinon.stub(adapter, 'createRecord').returns(
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
        );
        const deleteRequest = store.request(saveRecord(membership));
        const createRequest = store.request(saveRecord(newMembership));

        assert.true(membership.isSaving);
        assert.true(newMembership.isSaving);

        // Leaving the edit page, e.g. with "Annuleer", while the save runs
        controller.reset();

        assert.true(newMembership.isNew);
        assert.false(newMembership.isDestroying);
        assert.true(store.peekAll('membership').includes(newMembership));
        assert.true(membership.isDeleted);
        assert.strictEqual(controller.memberships, null);

        resolveDelete(null);
        resolveCreate({ data: { type: 'memberships', id: 'new-membership' } });
        await Promise.all([deleteRequest, createRequest]);

        assert.false(newMembership.isNew);
        assert.false(newMembership.isSaving);
        assert.strictEqual(newMembership.id, 'new-membership');
        assert.true(membership.isDeleted);
        assert.false(membership.hasDirtyAttributes);
        assert.strictEqual(store.peekAll('membership').length, 1);

        deleteStub.restore();
        createStub.restore();
      });

      test('it ignores a membership that was already unloaded', function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        membership.deleteRecord();
        membership.unloadRecord();

        assert.true(membership.isDestroying);

        controller.reset();

        assert.strictEqual(store.peekRecord('membership', 'membership'), null);
        assert.strictEqual(controller.memberships, null);
      });

      test('it does not throw when there are no memberships', function (assert) {
        const { organization } = pushOrganizationWithMembership(this.store());
        const controller = this.controller();
        controller.model = { organization };
        controller.memberships = null;

        controller.reset();

        assert.strictEqual(controller.memberships, null);
        assert.strictEqual(controller.selectedRoleLabel, null);
      });

      test('it unloads a period that was added to a persisted membership but not saved', function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setStartDate(membership, new Date('2024-01-01'));
        const period = membership.belongsTo('during').value();

        assert.true(period.isNew);
        assert.deepEqual(membership.during?.startDate, new Date('2024-01-01'));
        assert.true(controller.hasUnsavedEdits);

        controller.reset();

        assert.true(period.isDestroying);
        assert.strictEqual(membership.belongsTo('during').value(), null);
        assert.strictEqual(store.peekAll('period-of-time').length, 0);
        assert.false(membership.hasDirtyAttributes);
        assert.false(membership.isDestroying);

        // Opening the edit page again shows the membership without dates
        controller.setup();

        assert.deepEqual(controller.memberships, [membership]);
        assert.strictEqual(membership.during?.startDate, undefined);
        assert.false(controller.hasUnsavedEdits);
      });

      test('it restores the dates of a persisted period that were changed but not saved', function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const period = membership.belongsTo('during').value();
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setEndDate(membership, new Date('2026-01-01'));

        assert.true(period.hasDirtyAttributes);
        assert.deepEqual(membership.during?.endDate, new Date('2026-01-01'));
        assert.true(controller.hasUnsavedEdits);

        controller.reset();

        assert.false(period.hasDirtyAttributes);
        assert.false(period.isDestroying);
        assert.deepEqual(membership.during?.endDate, new Date('2025-01-01'));
        assert.strictEqual(store.peekAll('period-of-time').length, 1);

        // Opening the edit page again shows the original dates
        controller.setup();

        assert.deepEqual(controller.memberships, [membership]);
        assert.false(controller.hasUnsavedEdits);
      });

      test('it unloads the period of a new membership that was added but not saved', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.addMembership();
        const newMembership = controller.memberships.at(-1);
        controller.setEndDate(newMembership, new Date('2025-01-01'));

        assert.strictEqual(store.peekAll('period-of-time').length, 1);

        controller.reset();

        assert.strictEqual(store.peekAll('period-of-time').length, 0);
        assert.strictEqual(store.peekAll('membership').length, 1);

        await settled();

        assert.true(newMembership.isDestroyed);
      });

      test('it clears the validation errors of a persisted period whose dates were restored', async function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const period = membership.belongsTo('during').value();
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        // A start date after the end date fails validation
        controller.setStartDate(membership, new Date('2026-01-01'));
        await controller.save.perform(event);

        assert.true(this.submit.notCalled);
        assert.true(controller.hasValidationErrors);
        assert.notStrictEqual(period.error, undefined);
        assert.true(period.hasDirtyAttributes);

        controller.reset();

        assert.strictEqual(period.error, undefined);
        assert.false(period.hasDirtyAttributes);
        assert.deepEqual(membership.during?.endDate, new Date('2025-01-01'));

        // Opening the edit page again shows no errors
        controller.setup();

        assert.false(controller.hasValidationErrors);
      });

      test('it clears the validation errors of a persisted period whose dates were reverted by hand', async function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { startDate: null, endDate: new Date('2025-01-01') } },
        );
        const period = membership.belongsTo('during').value();
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setStartDate(membership, new Date('2026-01-01'));
        await controller.save.perform(event);
        controller.setStartDate(membership, null);

        assert.notStrictEqual(period.error, undefined);
        assert.false(period.hasDirtyAttributes);

        controller.reset();

        assert.strictEqual(period.error, undefined);
        assert.false(period.isDestroying);

        // Opening the edit page again shows no errors
        controller.setup();

        assert.false(controller.hasValidationErrors);
      });
    });

    module('setStartDate', function () {
      test('it does not create a period when an empty date is cleared', function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        // The date picker also reports an emptied input
        controller.setStartDate(membership, null);
        controller.setEndDate(membership, null);

        assert.strictEqual(membership.belongsTo('during').value(), null);
        assert.strictEqual(store.peekAll('period-of-time').length, 0);
        assert.false(controller.hasUnsavedEdits);
      });

      test('it creates the period of a membership on the first date', function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setEndDate(membership, new Date('2025-01-01'));

        const period = membership.belongsTo('during').value();
        assert.true(period.isNew);
        assert.strictEqual(
          period.endDate.getTime(),
          new Date('2025-01-01').getTime(),
        );
        assert.true(controller.hasUnsavedEdits);
      });
    });

    module('reallyRemoveMembership', function () {
      test('it unloads the period of a new membership that is removed', function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.addMembership();
        const newMembership = controller.memberships.at(-1);
        controller.setStartDate(newMembership, new Date('2024-01-01'));

        controller.reallyRemoveMembership(newMembership);

        assert.deepEqual(controller.memberships, [membership]);
        assert.strictEqual(store.peekAll('membership').length, 1);
        assert.strictEqual(store.peekAll('period-of-time').length, 0);
      });

      test('it keeps the period of a persisted membership that is removed until it is saved', function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.reallyRemoveMembership(membership);

        assert.true(membership.isDeleted);
        assert.deepEqual(controller.memberships, [membership]);
        assert.strictEqual(store.peekAll('period-of-time').length, 1);
      });
    });

    module('save', function (hooks) {
      // The organisation's own validation is covered by the kerngegevens tests.
      hooks.beforeEach(function () {
        sinon.stub(OrganizationModel.prototype, 'validate').resolves();
      });

      // A new membership with the persisted member and role, as the form creates it.
      function addMembershipBetween(controller, store, organization) {
        controller.addMembership();
        const membership = controller.memberships.at(-1);
        membership.role = store.peekRecord('membership-role', 'role');
        membership.member = organization;
        membership.organization = store.peekRecord('organization', 'member');
        return membership;
      }

      test('it submits a new period before the membership that links it', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();
        this.submit.resolves(new Map());

        controller.setStartDate(membership, new Date('2024-01-01'));
        const period = membership.belongsTo('during').value();

        await controller.save.perform(event);

        assert.true(this.submit.calledOnce);
        const [aggregate, target, records] = this.submit.firstCall.args;
        assert.strictEqual(aggregate, 'related-organizations');
        assert.strictEqual(target, organization.id);
        assert.deepEqual(
          records.map((record) => record.constructor.modelName),
          ['period-of-time', 'membership'],
          'the period before the membership that links it; the organisation is not part of the aggregate',
        );
        assert.strictEqual(records[0], period);
        assert.strictEqual(records[1], membership);
        assert.true(
          this.transitionTo.calledOnceWithExactly(
            'organizations.organization.related-organizations',
            organization.id,
          ),
        );
      });

      test('it only submits the period when the dates of a persisted period change', async function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const period = membership.belongsTo('during').value();
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();
        this.submit.resolves(new Map());

        controller.setEndDate(membership, new Date('2026-01-01'));

        await controller.save.perform(event);

        assert.deepEqual(this.submit.firstCall.args[2], [period]);
      });

      test('it submits a removed membership before its period', async function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const period = membership.belongsTo('during').value();
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();
        this.submit.resolves(new Map());

        controller.reallyRemoveMembership(membership);

        await controller.save.perform(event);

        assert.deepEqual(this.submit.firstCall.args[2], [membership, period]);
      });

      test('it does not submit a period without dates', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();
        this.submit.resolves(new Map());

        controller.setStartDate(membership, new Date('2024-01-01'));
        controller.setStartDate(membership, null);
        const period = membership.belongsTo('during').value();

        assert.true(isEmptyPeriod(period));

        await controller.save.perform(event);

        assert.strictEqual(membership.belongsTo('during').value(), null);
        assert.strictEqual(store.peekAll('period-of-time').length, 0);
        assert.true(
          this.submit.notCalled,
          'nothing changed, so no request is sent',
        );
      });

      test('it submits the period of a new membership before the membership', async function (assert) {
        const store = this.store();
        const { organization } = pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [] };
        controller.setup();
        this.submit.resolves(new Map());

        const newMembership = addMembershipBetween(
          controller,
          store,
          organization,
        );
        controller.setStartDate(newMembership, new Date('2024-01-01'));
        const period = newMembership.belongsTo('during').value();

        await controller.save.perform(event);

        assert.deepEqual(this.submit.firstCall.args[2], [
          period,
          newMembership,
        ]);
      });

      test('it does not save when the start date is after the end date', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setStartDate(membership, new Date('2025-01-01'));
        controller.setEndDate(membership, new Date('2024-01-01'));
        const period = membership.belongsTo('during').value();

        await controller.save.perform(event);

        assert.true(this.submit.notCalled);
        assert.true(controller.hasValidationErrors);
        assert.propContains(period.error, {
          startDate: {
            message: 'Kies een startdatum die vóór de einddatum plaatsvindt',
          },
          endDate: {
            message: 'Kies een einddatum die na de startdatum plaatsvindt',
          },
        });
        assert.true(this.transitionTo.notCalled);
      });

      test('it keeps a new membership that only has dates so that it fails validation', async function (assert) {
        const store = this.store();
        const { organization } = pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [] };
        controller.setup();

        controller.addMembership();
        const newMembership = controller.memberships.at(-1);
        controller.setEndDate(newMembership, new Date('2025-01-01'));

        await controller.save.perform(event);

        assert.true(this.submit.notCalled);
        assert.true(controller.hasValidationErrors);
        assert.deepEqual(controller.memberships, [newMembership]);
        assert.propContains(newMembership.error, {
          role: { message: 'Selecteer een optie' },
        });
      });

      test('it does not validate the period of a removed membership', async function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();
        this.submit.resolves(new Map());

        // A start date after the end date, entered before removing the row
        controller.setStartDate(membership, new Date('2026-01-01'));
        controller.reallyRemoveMembership(membership);

        await controller.save.perform(event);

        assert.true(this.submit.calledOnce);
        assert.false(controller.hasValidationErrors);
        assert.true(this.transitionTo.calledOnce);
      });

      test('it discards the unsaved period of a removed membership', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();
        this.submit.resolves(new Map());

        // Invalid dates, entered before removing the row
        controller.setStartDate(membership, new Date('2025-01-01'));
        controller.setEndDate(membership, new Date('2024-01-01'));
        controller.reallyRemoveMembership(membership);

        await controller.save.perform(event);

        assert.deepEqual(this.submit.firstCall.args[2], [membership]);
        assert.false(controller.hasValidationErrors);
        assert.strictEqual(store.peekAll('period-of-time').length, 0);
        assert.true(this.transitionTo.calledOnce);
      });

      test('it does not send a request when nothing changed', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        await controller.save.perform(event);

        assert.true(this.submit.notCalled);
        assert.true(
          this.transitionTo.calledOnceWithExactly(
            'organizations.organization.related-organizations',
            organization.id,
          ),
        );
      });

      test('it reloads the page and shows the notice when the service holds the request', async function (assert) {
        const store = this.store();
        const { organization, membership } = pushOrganizationWithMembership(
          store,
          { period: { endDate: new Date('2025-01-01') } },
        );
        const controller = this.controller();
        const revision = controller.formRevision;
        this.submit.rejects(
          new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
            status: 409,
            held: true,
            waiting: false,
            requestId: null,
            conflicts: [
              {
                resource: { type: 'periods-of-time', id: 'period' },
                key: 'end-date',
                base: '2025-01-01',
                current: '2025-06-01',
                proposed: '2026-01-01',
                'competing-requests': [],
              },
            ],
          }),
        );
        // Refreshing resets the controller, as the edit route's resetController does.
        this.refresh.callsFake(async () => {
          controller.reset();
          assert.strictEqual(controller.formRevision, revision);
        });
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setEndDate(membership, new Date('2026-01-01'));

        await controller.save.perform(event);

        assert.true(
          this.refresh.calledOnceWithExactly(
            'organizations.organization.related-organizations',
          ),
        );
        assert.strictEqual(controller.formRevision, revision + 1);
        assert.deepEqual(controller.heldRequest, {
          id: null,
          fields: ['Einddatum relatie'],
          reloadFailed: false,
          waiting: false,
        });
        assert.true(this.transitionTo.notCalled);
        assert.strictEqual(controller.saveError, null);
        assert.false(controller.saveBlocked);
      });

      test('it blocks saving and keeps the request to link to when its apply failed', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        this.submit.rejects(
          new ChangeRequestError('De wijziging kon niet doorgevoerd worden.', {
            status: 409,
            applyFailed: true,
            requestId: REQUEST_ID,
          }),
        );
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setStartDate(membership, new Date('2024-01-01'));

        await controller.save.perform(event);

        assert.true(controller.saveBlocked);
        assert.strictEqual(controller.failedRequestId, REQUEST_ID);
        assert.strictEqual(this.controller.saveError, undefined);

        await controller.save.perform(event);

        assert.true(this.submit.calledOnce, 'a second save sends nothing');
      });

      test('it shows the message of the service and keeps the edits when the request is refused', async function (assert) {
        const store = this.store();
        const { organization, membership } =
          pushOrganizationWithMembership(store);
        const controller = this.controller();
        this.submit.rejects(
          new ChangeRequestError('U mag deze organisatie niet bewerken.', {
            status: 403,
          }),
        );
        controller.model = { organization, memberships: [membership] };
        controller.setup();

        controller.setStartDate(membership, new Date('2024-01-01'));

        await controller.save.perform(event);

        assert.strictEqual(
          controller.saveError,
          'U mag deze organisatie niet bewerken.',
        );
        assert.strictEqual(controller.heldRequest, null);
        assert.false(controller.saveBlocked);
        assert.true(this.refresh.notCalled);
        assert.true(this.transitionTo.notCalled);
        assert.notStrictEqual(membership.belongsTo('during').value(), null);
      });
    });

    module('removeMembership', function () {
      /**
       * Push a persisted district with the given number of municipalities
       * founding it, as the edit route would have loaded them.
       */
      function pushDistrictWithFounders(store, founderCount) {
        const data = [
          {
            type: 'administrative-unit-classification-code',
            id: CLASSIFICATION.MUNICIPALITY.id,
            attributes: { label: CLASSIFICATION.MUNICIPALITY.label },
          },
          {
            type: 'administrative-unit-classification-code',
            id: CLASSIFICATION.DISTRICT.id,
            attributes: { label: CLASSIFICATION.DISTRICT.label },
          },
          {
            type: 'membership-role',
            id: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
            attributes: { label: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.label },
          },
          {
            type: 'administrative-unit',
            id: 'district',
            attributes: { name: 'District Aalst' },
            relationships: {
              classification: {
                data: {
                  type: 'administrative-unit-classification-code',
                  id: CLASSIFICATION.DISTRICT.id,
                },
              },
            },
          },
        ];
        for (let index = 0; index < founderCount; index++) {
          data.push(
            {
              type: 'administrative-unit',
              id: `municipality-${index}`,
              relationships: {
                classification: {
                  data: {
                    type: 'administrative-unit-classification-code',
                    id: CLASSIFICATION.MUNICIPALITY.id,
                  },
                },
              },
            },
            {
              type: 'membership',
              id: `membership-${index}`,
              relationships: {
                organization: {
                  data: { type: 'administrative-unit', id: 'district' },
                },
                member: {
                  data: {
                    type: 'administrative-unit',
                    id: `municipality-${index}`,
                  },
                },
                role: {
                  data: {
                    type: 'membership-role',
                    id: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
                  },
                },
              },
            },
          );
        }
        store.push({ data });
        return {
          district: store.peekRecord('administrative-unit', 'district'),
          municipality: store.peekRecord(
            'administrative-unit',
            'municipality-0',
          ),
          memberships: Array.from({ length: founderCount }, (_, index) =>
            store.peekRecord('membership', `membership-${index}`),
          ),
        };
      }

      test('it shows an error instead of the confirmation when the removal takes the organization being edited below its minimum', async function (assert) {
        const store = this.store();
        const { district, memberships } = pushDistrictWithFounders(store, 1);
        const controller = this.controller();
        controller.model = { organization: district, memberships };
        controller.setup();

        await controller.removeMembership.perform(memberships[0]);

        assert.notOk(controller.founderToRemove);
        assert.true(
          controller.membershipRemovalError.includes('je organisatie'),
        );
      });

      test('it shows an error naming the other organization when the removal takes that organization below its minimum', async function (assert) {
        const store = this.store();
        const { municipality, memberships } = pushDistrictWithFounders(
          store,
          1,
        );
        const controller = this.controller();
        // The edit page of the municipality shows the founder membership with
        // the district on the other side.
        controller.model = { organization: municipality, memberships };
        controller.setup();
        const queryStub = sinon
          .stub(this.owner.lookup('adapter:application'), 'query')
          .resolves({
            data: [
              {
                type: 'membership',
                id: memberships[0].id,
                relationships: {
                  organization: {
                    data: { type: 'administrative-unit', id: 'district' },
                  },
                  member: {
                    data: {
                      type: 'administrative-unit',
                      id: 'municipality-0',
                    },
                  },
                  role: {
                    data: {
                      type: 'membership-role',
                      id: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
                    },
                  },
                },
              },
            ],
          });

        await controller.removeMembership.perform(memberships[0]);

        assert.notOk(controller.founderToRemove);
        assert.true(
          controller.membershipRemovalError.includes('District Aalst'),
        );

        queryStub.restore();
      });

      test('it shows the confirmation when both organizations keep meeting their minimums', async function (assert) {
        const store = this.store();
        const { municipality, memberships } = pushDistrictWithFounders(
          store,
          2,
        );
        const controller = this.controller();
        controller.model = { organization: municipality, memberships };
        controller.setup();
        const queryStub = sinon
          .stub(this.owner.lookup('adapter:application'), 'query')
          .resolves({
            data: memberships.map((membership) => ({
              type: 'membership',
              id: membership.id,
              relationships: {
                organization: {
                  data: { type: 'administrative-unit', id: 'district' },
                },
                member: {
                  data: {
                    type: 'administrative-unit',
                    id: membership.member.id,
                  },
                },
                role: {
                  data: {
                    type: 'membership-role',
                    id: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
                  },
                },
              },
            })),
          });

        await controller.removeMembership.perform(memberships[0]);

        assert.strictEqual(controller.founderToRemove, memberships[0]);
        assert.notOk(controller.membershipRemovalError);

        queryStub.restore();
      });

      /**
       * Push a persisted district without stored founders, plus one
       * municipality to pick in a new row, as the edit route would have
       * loaded them.
       */
      function pushDistrictWithoutFounders(store) {
        store.push({
          data: [
            {
              type: 'administrative-unit-classification-code',
              id: CLASSIFICATION.MUNICIPALITY.id,
              attributes: { label: CLASSIFICATION.MUNICIPALITY.label },
            },
            {
              type: 'administrative-unit-classification-code',
              id: CLASSIFICATION.DISTRICT.id,
              attributes: { label: CLASSIFICATION.DISTRICT.label },
            },
            {
              type: 'membership-role',
              id: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
              attributes: {
                label: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.label,
              },
            },
            {
              type: 'administrative-unit',
              id: 'district',
              relationships: {
                classification: {
                  data: {
                    type: 'administrative-unit-classification-code',
                    id: CLASSIFICATION.DISTRICT.id,
                  },
                },
              },
            },
            {
              type: 'administrative-unit',
              id: 'municipality-0',
              relationships: {
                classification: {
                  data: {
                    type: 'administrative-unit-classification-code',
                    id: CLASSIFICATION.MUNICIPALITY.id,
                  },
                },
              },
            },
          ],
        });
        return {
          district: store.peekRecord('administrative-unit', 'district'),
          municipality: store.peekRecord(
            'administrative-unit',
            'municipality-0',
          ),
        };
      }

      test('it immediately removes a row that was added in this session, even below the minimum', async function (assert) {
        const store = this.store();
        const { district, municipality } = pushDistrictWithoutFounders(store);
        const controller = this.controller();
        controller.model = {
          organization: district,
          memberships: [],
        };
        controller.setup();

        // A founder row was added and the wrong organization was picked in
        // it. Nothing was stored, so the row is removed at once instead of
        // opening the confirmation, even though the district is below its
        // minimum of one founder.
        const row = controller.memberships[0];
        assert.true(row.isNew);
        row.role = store.peekRecord(
          'membership-role',
          MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
        );
        row.organization = district;
        row.member = municipality;

        await controller.removeMembership.perform(row);

        assert.notOk(controller.founderToRemove);
        assert.notOk(controller.membershipRemovalError);
        assert.deepEqual(controller.memberships, []);
      });

      /**
       * Wait until a started removal reaches its fetch of the other
       * organization's memberships. (`settled` cannot be used: it waits for
       * that request, which only finishes once the test resolves the stub.)
       */
      async function untilFetched(queryStub) {
        for (let attempts = 0; attempts < 50 && !queryStub.called; attempts++) {
          await new Promise((resolve) => setTimeout(resolve));
        }
      }

      test("it does not open the confirmation when the page was left while the other organization's memberships loaded", async function (assert) {
        const store = this.store();
        const { municipality, memberships } = pushDistrictWithFounders(
          store,
          1,
        );
        const controller = this.controller();
        controller.model = { organization: municipality, memberships };
        controller.setup();
        const resolveQueries = [];
        const queryStub = sinon
          .stub(this.owner.lookup('adapter:application'), 'query')
          .callsFake(
            () =>
              new Promise((resolve) => {
                resolveQueries.push(resolve);
              }),
          );

        const removal = controller.removeMembership.perform(memberships[0]);
        // The fetch is pending now; leaving the edit page while it runs:
        // resetController clears the page state.
        await untilFetched(queryStub);
        controller.reset();
        resolveQueries[0]({ data: [] });
        await removal;

        assert.notOk(controller.founderToRemove);
        assert.notOk(controller.membershipRemovalError);

        queryStub.restore();
      });

      test('it drops a second removal click while the first is still fetching, so one confirmation opens', async function (assert) {
        const store = this.store();
        const { municipality, memberships } = pushDistrictWithFounders(
          store,
          2,
        );
        const controller = this.controller();
        controller.model = { organization: municipality, memberships };
        controller.setup();
        // The district keeps meeting its minimum of one founder after either
        // removal, so both would open the confirmation.
        const storedMemberships = memberships.map((membership) => ({
          type: 'membership',
          id: membership.id,
          relationships: {
            organization: {
              data: { type: 'administrative-unit', id: 'district' },
            },
            member: {
              data: { type: 'administrative-unit', id: membership.member.id },
            },
            role: {
              data: {
                type: 'membership-role',
                id: MEMBERSHIP_ROLES_MAPPING.IS_FOUNDER_OF.id,
              },
            },
          },
        }));
        const resolveQueries = [];
        const queryStub = sinon
          .stub(this.owner.lookup('adapter:application'), 'query')
          .callsFake(
            () =>
              new Promise((resolve) => {
                resolveQueries.push(resolve);
              }),
          );

        const firstRemoval = controller.removeMembership.perform(
          memberships[0],
        );
        // Let the first removal reach its fetch before the second click.
        await untilFetched(queryStub);
        const secondRemoval = controller.removeMembership.perform(
          memberships[1],
        );

        assert.true(secondRemoval.isDropped);
        assert.strictEqual(queryStub.callCount, 1);

        resolveQueries[0]({ data: storedMemberships });
        await firstRemoval;

        assert.strictEqual(controller.founderToRemove, memberships[0]);
        assert.notOk(controller.membershipRemovalError);

        queryStub.restore();
      });
    });
  },
);
