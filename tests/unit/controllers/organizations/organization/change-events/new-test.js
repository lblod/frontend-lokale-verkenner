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
            label:
              id === ORGANIZATION_STATUS.INACTIVE ? 'Niet actief' : 'Actief',
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
    function setupForm(
      store,
      controller,
      typeId,
      { date = new Date(2026, 9, 1) } = {},
    ) {
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
      assert.true(
        controller.excludedTypeIds.includes(CHANGE_EVENT_TYPE.MERGER),
      );
      assert.strictEqual(controller.submitLabel, 'Aanvraag versturen');

      this.changeRequests.rights = { canDecide: true, canCreate: [] };
      assert.true(controller.appliesAtOnce);
      assert.strictEqual(controller.submitLabel, 'Opslaan');
    });

    test('it does not submit without a type and a date, nor a name change without the new name', async function (assert) {
      const { controller } = this;
      const { changeEvent } = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
        { date: null },
      );
      changeEvent.type = null;

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.true(this.submit.notCalled);
      assert.ok(changeEvent.error.type, 'the type is required');
      assert.ok(changeEvent.error.date, 'the date is required');

      const form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
      await controller.submitRequestTask.perform({ preventDefault() {} });
      assert.true(this.submit.notCalled);
      assert.ok(
        form.changeEvent.error.resultingName,
        'the new name is required',
      );
    });

    test('a naamswijziging submits the event, its result and the renamed organisation as one request about the organisation, and goes to the request when it waits', async function (assert) {
      const { controller } = this;
      const { organization, changeEvent, decision } = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
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
      assert.strictEqual(
        target,
        'org-1',
        'the request is about the organisation',
      );
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        [
          'decision',
          'change-event',
          'change-event-result',
          'administrative-unit',
        ],
      );
      assert.deepEqual(options, { reason: 'Besluit van de gemeenteraad' });
      assert.deepEqual(
        decision.documentLinks,
        ['https://aalst.be/besluiten/2026/124'],
        'empty links are dropped',
      );
      assert.strictEqual((await changeEvent.decision)?.id, decision.id);
      const result = records[2];
      assert.strictEqual(result.resultingName, 'Stad Aalst');
      assert.strictEqual(
        result.originalName,
        'Aalst',
        'the result keeps the name the event changes',
      );
      assert.strictEqual((await result.status)?.id, ORGANIZATION_STATUS.ACTIVE);
      assert.strictEqual((await result.resultingOrganization)?.id, 'org-1');
      assert.strictEqual(
        organization.legalName,
        'Stad Aalst',
        'the organisation carries the new name',
      );
      assert.deepEqual(
        (await changeEvent.resultingOrganizations).map((o) => o.id),
        ['org-1'],
      );
      assert.true(this.success.calledOnce);
      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'aanvragen.aanvraag',
          REQUEST_ID,
        ),
      );
    });

    test('an ontbinding sets the organisation inactive; ABB sees the event at once', async function (assert) {
      const { controller } = this;
      this.changeRequests.rights = { canDecide: true, canCreate: [] };
      const { organization, changeEvent } = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.ONTBONDEN_EN_VEREFFEND,
      );
      this.submit.resolves(new Map([[changeEvent, { id: 'event-1' }]]));

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.strictEqual(
        (await organization.organizationStatus)?.id,
        ORGANIZATION_STATUS.INACTIVE,
      );
      const records = this.submit.firstCall.args[2];
      assert.deepEqual(
        records.map((record) => record.constructor.modelName),
        ['change-event', 'change-event-result', 'administrative-unit'],
        'no decision without links or date',
      );
      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'organizations.organization.change-events.details',
          'event-1',
        ),
      );
      assert.true(this.success.notCalled);
    });

    test('a refusal keeps the form and shows the message, and puts the organisation back for another attempt; cancelling drops the event', async function (assert) {
      const { controller } = this;
      const { organization, changeEvent } = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
      controller.resultingName = 'Stad Aalst';
      const sentNames = [];
      this.submit.callsFake(async () => {
        sentNames.push(organization.legalName);
        throw new ChangeRequestError('Je mag deze organisatie niet bewerken.', {
          status: 403,
        });
      });

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.strictEqual(
        controller.saveError,
        'Je mag deze organisatie niet bewerken.',
      );
      assert.false(controller.saveBlocked);
      assert.true(this.replaceWith.notCalled);
      assert.strictEqual(
        controller.resultingName,
        'Stad Aalst',
        'the form keeps its values',
      );
      assert.strictEqual(
        organization.legalName,
        'Aalst',
        'the organisation is back as it was loaded',
      );
      const [, firstResult] = this.submit.firstCall.args[2];
      assert.strictEqual(
        firstResult.constructor.modelName,
        'change-event-result',
      );
      assert.true(
        firstResult.isDestroying,
        'the result of the attempt is dropped',
      );
      assert.deepEqual(
        (await changeEvent.originalOrganizations).map((o) => o.id),
        ['org-1'],
        'the event is still about the organisation',
      );

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.deepEqual(
        this.submit.secondCall.args[2].map(
          (record) => record.constructor.modelName,
        ),
        ['change-event', 'change-event-result', 'administrative-unit'],
        'another attempt sends the same',
      );
      assert.deepEqual(sentNames, ['Stad Aalst', 'Stad Aalst']);
      assert.deepEqual(
        (await changeEvent.resultingOrganizations).map((o) => o.id),
        [],
      );

      controller.reset();

      assert.strictEqual(organization.legalName, 'Aalst', 'rolled back');
      assert.true(changeEvent.isDestroying, 'the new event is dropped');
      assert.strictEqual(controller.saveError, null);
    });

    test('when the outcome is unknown nothing can be sent until the page is reloaded', async function (assert) {
      const { controller } = this;
      const { organization } = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
      controller.resultingName = 'Stad Aalst';
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet verwerkt worden.', {
          status: 502,
        }),
      );

      await controller.submitRequestTask.perform({ preventDefault() {} });
      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.true(this.submit.calledOnce, 'the second attempt sends nothing');
      assert.true(controller.saveBlocked);
      assert.true(controller.saveError.includes('Alle aanvragen'));
      assert.strictEqual(organization.legalName, 'Aalst');

      controller.reset();
      assert.false(controller.saveBlocked);
    });

    test("ABB's request that was applied but not followed up goes to the events, one whose apply failed to the request", async function (assert) {
      const { controller } = this;
      this.changeRequests.rights = { canDecide: true, canCreate: [] };
      const warning = sinon.stub(
        this.owner.lookup('service:toaster'),
        'warning',
      );
      setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.ONTBONDEN_EN_VEREFFEND,
      );
      this.submit.rejects(
        new ChangeRequestError('De wijziging is doorgevoerd, maar ...', {
          status: 201,
          applied: true,
          requestId: REQUEST_ID,
        }),
      );

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'organizations.organization.change-events',
        ),
      );
      assert.true(warning.calledOnce);

      this.replaceWith.resetHistory();
      this.submit.rejects(
        new ChangeRequestError('Het toepassen mislukte.', {
          status: 409,
          applyFailed: true,
          requestId: REQUEST_ID,
        }),
      );
      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'aanvragen.aanvraag',
          REQUEST_ID,
        ),
      );
    });

    test("ABB's own request that waits over changed data goes to the request with a notice for ABB", async function (assert) {
      const { controller } = this;
      this.changeRequests.rights = { canDecide: true, canCreate: [] };
      const warning = sinon.stub(
        this.owner.lookup('service:toaster'),
        'warning',
      );
      setupForm(this.store, controller, CHANGE_EVENT_TYPE.NAME_CHANGE);
      controller.resultingName = 'Stad Aalst';
      this.submit.rejects(
        new ChangeRequestError('De aanvraag wacht.', {
          status: 201,
          held: true,
          waiting: true,
          requestId: REQUEST_ID,
          conflicts: [
            {
              resource: { type: 'administrative-units', id: 'org-1' },
              key: 'name',
            },
          ],
        }),
      );

      await controller.submitRequestTask.perform({ preventDefault() {} });

      assert.true(this.success.notCalled, 'not "gevalideerd door ABB"');
      assert.true(warning.firstCall.args[0].includes('keur de aanvraag goed'));
      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'aanvragen.aanvraag',
          REQUEST_ID,
        ),
      );
    });

    /**
     * A legal form, a werkingsgebied (as one location) and two
     * qualifications, given to the organisation of the form as its current
     * values; `other*` are the values it does not have.
     */
    function giveCurrentValues(store, organization) {
      const [
        legalForm,
        otherLegalForm,
        scope,
        otherLocation,
        qualification,
        otherQualification,
      ] = store.push({
        data: [
          { type: 'concept', id: 'legal-form-1', attributes: { label: 'AGB' } },
          { type: 'concept', id: 'legal-form-2', attributes: { label: 'vzw' } },
          { type: 'location', id: 'aalst', attributes: { label: 'Aalst' } },
          { type: 'location', id: 'gent', attributes: { label: 'Gent' } },
          {
            type: 'additional-qualification-code',
            id: 'qualification-1',
            attributes: { label: 'Erkend' },
          },
          {
            type: 'additional-qualification-code',
            id: 'qualification-2',
            attributes: { label: 'Gesubsidieerd' },
          },
        ],
      });
      organization.legalForm = legalForm;
      organization.scope = scope;
      organization.additionalQualifications = [qualification];
      return {
        legalForm,
        otherLegalForm,
        scope,
        otherLocation,
        qualification,
        otherQualification,
      };
    }

    test('a new value that equals the current one is refused, for each type that changes a field', async function (assert) {
      const { controller } = this;

      let form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
      controller.resultingName = ' Aalst ';
      await controller.submitRequestTask.perform({ preventDefault() {} });
      assert.strictEqual(
        form.changeEvent.error.resultingName?.message,
        'De huidige en nieuwe waarde kunnen niet hetzelfde zijn.',
        'the current name',
      );

      form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.LEGAL_FORM_CHANGE,
      );
      let current = giveCurrentValues(this.store, form.organization);
      controller.selectedResultingLegalForm = current.legalForm;
      await controller.submitRequestTask.perform({ preventDefault() {} });
      assert.strictEqual(
        form.changeEvent.error.resultingLegalForm?.message,
        'De huidige en nieuwe waarde kunnen niet hetzelfde zijn.',
        'the current legal form',
      );

      form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.WERKINGSGEBIED_CHANGE,
      );
      current = giveCurrentValues(this.store, form.organization);
      controller.currentLocationsInScope = [current.scope];
      controller.selectedResultingLocations = [current.scope];
      await controller.submitRequestTask.perform({ preventDefault() {} });
      assert.strictEqual(
        form.changeEvent.error.resultingScope?.message,
        'De huidige en nieuwe waarde kunnen niet hetzelfde zijn.',
        'the current werkingsgebied',
      );

      form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.ADDITIONAL_QUALIFICATION_CHANGE,
      );
      current = giveCurrentValues(this.store, form.organization);
      controller.selectedResultingAdditionalQualifications = [
        current.qualification,
      ];
      await controller.submitRequestTask.perform({ preventDefault() {} });
      assert.strictEqual(
        form.changeEvent.error.resultingAdditionalQualifications?.message,
        'De huidige en nieuwe waarde kunnen niet hetzelfde zijn.',
        'the current qualifications',
      );

      assert.true(this.submit.notCalled, 'nothing is sent');
    });

    test('a legal form, werkingsgebied or qualifications change keeps the current value on the result before the organisation follows the event', async function (assert) {
      const { controller } = this;
      sinon
        .stub(
          this.owner.lookup('service:scope-of-operation'),
          'getScopeForLocations',
        )
        .callsFake(async (...locations) => locations[0]);
      this.submit.rejects(
        new ChangeRequestError('De aanvraag wacht op ABB.', {
          status: 201,
          held: true,
          waiting: true,
          requestId: REQUEST_ID,
        }),
      );

      let form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.LEGAL_FORM_CHANGE,
      );
      let current = giveCurrentValues(this.store, form.organization);
      controller.selectedResultingLegalForm = current.otherLegalForm;
      await controller.submitRequestTask.perform({ preventDefault() {} });
      let result = this.submit.lastCall.args[2].find(
        (record) => record.constructor.modelName === 'change-event-result',
      );
      assert.strictEqual(
        (await result.originalLegalForm)?.id,
        'legal-form-1',
        'the current legal form',
      );
      assert.strictEqual((await result.resultingLegalForm)?.id, 'legal-form-2');
      assert.strictEqual(
        (await form.organization.legalForm)?.id,
        'legal-form-2',
        'the organisation follows the event',
      );
      assert.notOk(result.originalName, 'nothing else is kept');
      assert.notOk(result.originalScope);
      assert.deepEqual(result.originalAdditionalQualifications.slice(), []);

      form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.WERKINGSGEBIED_CHANGE,
      );
      current = giveCurrentValues(this.store, form.organization);
      controller.currentLocationsInScope = [current.scope];
      controller.selectedResultingLocations = [current.otherLocation];
      await controller.submitRequestTask.perform({ preventDefault() {} });
      result = this.submit.lastCall.args[2].find(
        (record) => record.constructor.modelName === 'change-event-result',
      );
      assert.strictEqual(
        result.originalScope?.id,
        'aalst',
        'the current werkingsgebied',
      );
      assert.strictEqual(result.resultingScope?.id, 'gent');
      assert.strictEqual((await form.organization.scope)?.id, 'gent');

      form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.ADDITIONAL_QUALIFICATION_CHANGE,
      );
      current = giveCurrentValues(this.store, form.organization);
      controller.selectedResultingAdditionalQualifications = [
        current.qualification,
        current.otherQualification,
      ];
      await controller.submitRequestTask.perform({ preventDefault() {} });
      result = this.submit.lastCall.args[2].find(
        (record) => record.constructor.modelName === 'change-event-result',
      );
      assert.deepEqual(
        result.originalAdditionalQualifications.map(({ id }) => id),
        ['qualification-1'],
        'the current qualifications',
      );
      assert.deepEqual(
        result.resultingAdditionalQualifications.map(({ id }) => id),
        ['qualification-1', 'qualification-2'],
      );
      assert.deepEqual(
        form.organization.additionalQualifications.map(({ id }) => id),
        ['qualification-1', 'qualification-2'],
      );
      assert.strictEqual(this.submit.callCount, 3);
    });

    test('choosing a type prefills the current werkingsgebied or qualifications and clears what another type filled in', async function (assert) {
      const { controller } = this;
      const form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
      const current = giveCurrentValues(this.store, form.organization);
      const locationsInScope = sinon
        .stub(
          this.owner.lookup('service:scope-of-operation'),
          'getLocationsInScope',
        )
        .resolves([current.scope]);
      const [werkingsgebied, qualifications, legalForm] = this.store.push({
        data: [
          CHANGE_EVENT_TYPE.WERKINGSGEBIED_CHANGE,
          CHANGE_EVENT_TYPE.ADDITIONAL_QUALIFICATION_CHANGE,
          CHANGE_EVENT_TYPE.LEGAL_FORM_CHANGE,
        ].map((id) => ({
          type: 'change-event-type',
          id,
          attributes: { label: id },
        })),
      });
      controller.resultingName = 'Stad Aalst';

      await controller.updateChangeEventType(werkingsgebied);

      assert.strictEqual(form.changeEvent.type, werkingsgebied);
      assert.true(locationsInScope.calledOnceWith(form.organization));
      assert.deepEqual(
        controller.selectedResultingLocations.map(({ id }) => id),
        ['aalst'],
        'the werkingsgebied starts from the current one',
      );
      assert.deepEqual(
        controller.currentLocationsInScope.map(({ id }) => id),
        ['aalst'],
      );
      assert.strictEqual(controller.resultingName, null, 'cleared');

      await controller.updateChangeEventType(qualifications);

      assert.deepEqual(controller.selectedResultingLocations, []);
      assert.strictEqual(controller.currentLocationsInScope, null);
      assert.deepEqual(
        controller.selectedResultingAdditionalQualifications.map(
          ({ id }) => id,
        ),
        ['qualification-1'],
        'the qualifications start from the current ones',
      );

      controller.selectedResultingAdditionalQualifications.push(
        current.otherQualification,
      );
      assert.deepEqual(
        form.organization.additionalQualifications.map(({ id }) => id),
        ['qualification-1'],
        'a copy: the organisation keeps its qualifications',
      );

      await controller.updateChangeEventType(legalForm);
      assert.deepEqual(
        controller.selectedResultingAdditionalQualifications,
        [],
      );
      assert.strictEqual(
        controller.selectedResultingLegalForm,
        null,
        'the legal form is chosen anew',
      );
    });

    test('without an answer of the scope-of-operation service the werkingsgebied starts empty, and a type chosen meanwhile wins', async function (assert) {
      const { controller } = this;
      const form = setupForm(
        this.store,
        controller,
        CHANGE_EVENT_TYPE.NAME_CHANGE,
      );
      const current = giveCurrentValues(this.store, form.organization);
      const warn = sinon.stub(console, 'warn');
      const locationsInScope = sinon.stub(
        this.owner.lookup('service:scope-of-operation'),
        'getLocationsInScope',
      );
      const [werkingsgebied, name] = this.store.push({
        data: [
          CHANGE_EVENT_TYPE.WERKINGSGEBIED_CHANGE,
          CHANGE_EVENT_TYPE.NAME_CHANGE,
        ].map((id) => ({
          type: 'change-event-type',
          id,
          attributes: { label: id },
        })),
      });

      // The service did not answer
      locationsInScope.resolves(null);
      await controller.updateChangeEventType(werkingsgebied);
      assert.deepEqual(controller.selectedResultingLocations, []);
      assert.strictEqual(controller.currentLocationsInScope, null);

      // The locations could not be loaded
      locationsInScope.rejects(new Error('Nope'));
      await controller.updateChangeEventType(werkingsgebied);
      assert.deepEqual(controller.selectedResultingLocations, []);
      assert.true(warn.calledOnce);

      // Another type was chosen while the locations were loading
      let answer;
      locationsInScope.callsFake(
        () => new Promise((resolve) => (answer = resolve)),
      );
      const loading = controller.updateChangeEventType(werkingsgebied);
      await controller.updateChangeEventType(name);
      answer([current.scope]);
      await loading;
      assert.strictEqual(form.changeEvent.type, name);
      assert.deepEqual(controller.selectedResultingLocations, []);
      assert.strictEqual(controller.currentLocationsInScope, null);
    });
  },
);
