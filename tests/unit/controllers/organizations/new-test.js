import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import NewController from 'frontend-organization-portal/controllers/organizations/new';
import {
  ChangeRequestError,
  kboConflictMessage,
} from 'frontend-organization-portal/services/change-requests';
import {
  createPrimaryContact,
  createSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';
import { ORGANIZATION_STATUS } from 'frontend-organization-portal/models/organization-status-code';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';

const AGB_URI = `http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/${CLASSIFICATION.AGB.id}`;
const REQUEST_ID = '25e29be4-7c4e-4044-9357-2196fa23a17e';

module('Unit | Controller | organizations/new', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    // The organizations routes are built into a lazy bundle, so the
    // controller must be registered before the owner can look it up
    this.owner.register('controller:organizations/new', NewController);
    this.store = this.owner.lookup('service:store');
    this.controller = this.owner.lookup('controller:organizations/new');
    this.changeRequests = this.owner.lookup('service:change-requests');
    this.changeRequests.rights = { canDecide: false, canCreate: [AGB_URI] };
    this.submit = sinon.stub(this.changeRequests, 'submit');
    this.replaceWith = sinon.stub(
      this.owner.lookup('service:router'),
      'replaceWith',
    );
    this.success = sinon.stub(this.owner.lookup('service:toaster'), 'success');
    // The contact data of a new organisation is edited here when the flag is
    // on, as in development; without it the contact card is a notice
    this.owner.lookup('service:features').setup({ 'edit-contact-data': true });
    // The KBO uniqueness check of the identifier model queries the backend
    sinon
      .stub(this.owner.lookup('adapter:application'), 'query')
      .resolves({ data: [] });
    // The site types, for the type of the primary site: none by default
    this.findAll = sinon
      .stub(this.owner.lookup('adapter:application'), 'findAll')
      .resolves({ data: [] });
    // The werkingsgebied comes from the scope-of-operation service: here the
    // one location picked
    this.scopeFor = sinon
      .stub(
        this.owner.lookup('service:scope-of-operation'),
        'getScopeForLocations',
      )
      .callsFake(async (...locations) => locations[0]);
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  /**
   * The form as the route sets it up, with a complete AGB filled in.
   */
  function setupForm(store, controller, { complete = true } = {}) {
    const [
      classification,
      status,
      legalForm,
      location,
      oprichting,
      theme,
      qualification,
    ] = store.push({
      data: [
        {
          type: 'administrative-unit-classification-code',
          id: CLASSIFICATION.AGB.id,
          attributes: { label: CLASSIFICATION.AGB.label },
        },
        {
          type: 'organization-status-code',
          id: ORGANIZATION_STATUS.ACTIVE,
          attributes: { label: 'Actief' },
        },
        { type: 'concept', id: 'legal-form-1', attributes: { label: 'vzw' } },
        {
          type: 'location',
          id: 'location-1',
          attributes: { label: 'Aalst' },
        },
        {
          type: 'change-event-type',
          id: CHANGE_EVENT_TYPE.OPRICHTING,
          attributes: { label: 'Oprichting' },
        },
        { type: 'concept', id: 'theme-1', attributes: { label: 'Cultuur' } },
        {
          type: 'additional-qualification-code',
          id: 'qualification-1',
          attributes: { label: 'Erkend' },
        },
      ],
    });

    const organization = store.createRecord('administrative-unit', {
      classification,
    });
    if (complete) {
      organization.setAbbName('AGB Aalst');
      organization.organizationStatus = status;
      organization.legalForm = legalForm;
      // An AGB needs a theme and a qualification, as OP's rules say
      organization.contentThemes = [theme];
      organization.additionalQualifications = [qualification];
      controller.locations = [location];
    }
    controller.set('currentOrganizationModel', organization);

    const structuredIdentifierKBO = store.createRecord(
      'structured-identifier',
      {
        localId: complete ? '0123456789' : '',
      },
    );
    const structuredIdentifierSharepoint = store.createRecord(
      'structured-identifier',
    );
    const decision = store.createRecord('decision', {
      documentLinks: complete ? ['https://aalst.be/besluiten/2026/123'] : [],
    });
    const changeEvent = store.createRecord('change-event', {
      type: oprichting,
      description: 'Oprichting',
      decision,
      date: complete ? new Date(2026, 9, 1) : null,
    });
    const address = store.createRecord('address', {
      country: 'België',
      street: 'Grote Markt',
      number: '1',
      postcode: '9300',
      municipality: 'Aalst',
      province: 'Oost-Vlaanderen',
    });
    const model = {
      primarySite: store.createRecord('site'),
      address,
      contact: createPrimaryContact(store),
      secondaryContact: createSecondaryContact(store),
      identifierKBO: store.createRecord('identifier', {
        idName: ID_NAME.KBO,
        structuredIdentifier: structuredIdentifierKBO,
      }),
      structuredIdentifierKBO,
      identifierSharepoint: store.createRecord('identifier', {
        idName: ID_NAME.SHAREPOINT,
        structuredIdentifier: structuredIdentifierSharepoint,
      }),
      structuredIdentifierSharepoint,
      changeEvent,
      decision,
    };
    controller.set('model', model);
    return { organization, ...model };
  }

  test('it offers the classifications the service allows and names the button after who submits', function (assert) {
    const { controller } = this;
    assert.deepEqual(
      controller.allowedClassificationIds,
      [CLASSIFICATION.AGB.id],
      'the uuid at the end of the URI',
    );
    assert.false(controller.appliesAtOnce);
    assert.strictEqual(controller.submitLabel, 'Aanvraag versturen');

    this.changeRequests.rights = { canDecide: true, canCreate: [] };
    assert.deepEqual(controller.allowedClassificationIds, []);
    assert.true(
      controller.appliesAtOnce,
      "ABB's registration is applied at once",
    );
    assert.strictEqual(controller.submitLabel, 'Voeg toe');
  });

  test('it does not submit an incomplete organisation', async function (assert) {
    const { controller } = this;
    setupForm(this.store, controller, { complete: false });

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(this.submit.notCalled);
    assert.true(controller.hasValidationErrors);
    assert.ok(
      controller.currentOrganizationModel.error.legalName,
      'the legal name is required',
    );
    assert.ok(
      controller.model.identifierKBO.error,
      'the KBO number is required for an AGB',
    );
    assert.strictEqual(
      controller.model.changeEvent.error.date.message,
      'Vul de datum in',
      'the date of the oprichting is required, as for every new change event',
    );
  });

  test('it submits the organisation with its KBO number, site, besluit and oprichting as one request and goes to the request when it waits for ABB', async function (assert) {
    const { controller } = this;
    const form = setupForm(this.store, controller);
    controller.reason = 'Opgericht bij besluit van 1 oktober 2026';
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
    assert.strictEqual(aggregate, 'new-organisation');
    assert.strictEqual(target, null, 'a creation has no target');
    assert.deepEqual(
      records.map((record) => record.constructor.modelName),
      [
        'structured-identifier',
        'identifier',
        'contact-point',
        'contact-point',
        'address',
        'site',
        'decision',
        'change-event',
        'change-event-result',
        'administrative-unit',
      ],
      'dependencies first, the organisation last; no SharePoint identifier without a value',
    );
    const result = records.find(
      (record) => record.constructor.modelName === 'change-event-result',
    );
    assert.strictEqual(
      await result.resultingOrganization,
      form.organization,
      'the oprichting results in the organisation',
    );
    assert.strictEqual(await result.resultFrom, form.changeEvent);
    assert.strictEqual(
      (await result.status)?.id,
      (await form.organization.organizationStatus)?.id,
      'with the status the organisation starts with',
    );
    assert.true(
      (await form.changeEvent.resultingOrganizations).includes(
        form.organization,
      ),
    );
    assert.deepEqual(options, {
      reason: 'Opgericht bij besluit van 1 oktober 2026',
    });
    assert.true(
      this.scopeFor.calledOnce,
      'the scope service decides the werkingsgebied',
    );
    assert.strictEqual((await form.organization.scope)?.id, 'location-1');
    assert.strictEqual(
      (await form.organization.primarySite)?.id,
      form.primarySite.id,
    );
    assert.strictEqual(
      form.address.fullAddress,
      'Grote Markt 1, 9300 Aalst, België',
    );
    assert.deepEqual(
      (await form.changeEvent.originalOrganizations).map(
        (organization) => organization,
      ),
      [form.organization],
      'the oprichting is about the new organisation',
    );
    assert.true(this.success.calledOnce);
    assert.true(
      this.replaceWith.calledOnceWithExactly('aanvragen.aanvraag', REQUEST_ID),
    );
  });

  test("ABB's registration is applied at once: the page goes to the new organisation", async function (assert) {
    const { controller } = this;
    this.changeRequests.rights = { canDecide: true, canCreate: [] };
    const { organization } = setupForm(this.store, controller);
    this.submit.resolves(new Map([[organization, { id: 'new-org' }]]));

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(
      this.replaceWith.calledOnceWithExactly(
        'organizations.organization',
        'new-org',
      ),
    );
    assert.true(this.success.notCalled);
  });

  test('a KBO number the register or a waiting request already holds is shown on the field', async function (assert) {
    const { controller } = this;
    const { identifierKBO } = setupForm(this.store, controller);
    this.submit.rejects(
      new ChangeRequestError(
        'KBO number 0123456789 belongs to organisation "org-2"',
        {
          status: 409,
          errors: [
            {
              status: '409',
              title:
                'An organisation with this KBO number is already registered',
              meta: {
                'kbo-number': '0123456789',
                organisation: { type: 'organizations', id: 'org-2' },
              },
            },
          ],
        },
      ),
    );

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.deepEqual(controller.kboConflict, {
      message: 'Er bestaat al een organisatie met dit KBO-nummer.',
    });
    assert.strictEqual(
      controller.saveError,
      'De aanvraag werd niet verstuurd. Controleer het KBO-nummer.',
      'in Dutch, without the text of the service',
    );
    assert.false(
      controller.hasValidationErrors,
      'no notice that a required field is empty',
    );
    assert.strictEqual(identifierKBO.error, undefined);
    assert.false(controller.saveBlocked, 'a corrected number can be sent');
    assert.true(this.replaceWith.notCalled);

    controller.setKbo({
      target: { inputmask: { unmaskedvalue: () => '0987654321' } },
    });
    assert.strictEqual(controller.kboConflict, null, 'a new number clears it');
  });

  test('the primary site is the primary site only, and a maatschappelijke zetel for an AGB, looked up among the site types', async function (assert) {
    const { controller } = this;
    const form = setupForm(this.store, controller);
    const findAll = this.findAll.resolves({
      data: [
        {
          type: 'site-types',
          id: 'f1381723dec42c0b6ba6492e41d6f5dd',
          attributes: { label: 'Maatschappelijke zetel' },
        },
        {
          type: 'site-types',
          id: 'other',
          attributes: { label: 'Andere vestiging' },
        },
      ],
    });
    this.submit.rejects(
      new ChangeRequestError('De aanvraag wacht op ABB.', {
        status: 201,
        held: true,
        waiting: true,
        requestId: REQUEST_ID,
      }),
    );

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(this.submit.calledOnce);
    assert.strictEqual(
      (await form.primarySite.siteType)?.id,
      'f1381723dec42c0b6ba6492e41d6f5dd',
    );
    assert.deepEqual(
      (await form.organization.sites).slice(),
      [],
      'not also among the other sites',
    );
    assert.true(findAll.calledOnce);
  });

  test('without the type in the code list the site has none; a type OP gives no zetel gets none', async function (assert) {
    const { controller } = this;
    const form = setupForm(this.store, controller);
    const { findAll } = this;
    this.submit.rejects(new ChangeRequestError('Nee.', { status: 403 }));

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(this.submit.calledOnce, 'the request is sent all the same');
    assert.strictEqual(await form.primarySite.siteType, null);

    // A Vlaamse gemeenschapscommissie: OP sets no site type for it
    findAll.resetHistory();
    const [vgc] = this.store.push({
      data: [
        {
          type: 'administrative-unit-classification-code',
          id: CLASSIFICATION.VLAAMSE_GEMEENSCHAPSCOMMISSIE.id,
          attributes: {
            label: CLASSIFICATION.VLAAMSE_GEMEENSCHAPSCOMMISSIE.label,
          },
        },
      ],
    });
    controller.organizationConverter(vgc);
    assert.strictEqual(
      controller.currentOrganizationModel.constructor.modelName,
      'administrative-unit',
      'a Vlaamse gemeenschapscommissie is a bestuurseenheid, not a bare organisation',
    );
    assert.strictEqual(
      await controller.registeredOfficeTypeFor(
        controller.currentOrganizationModel,
      ),
      null,
    );
    assert.true(findAll.notCalled);
  });

  test('a link row left empty is no link, and without link or date there is no besluit in the request', async function (assert) {
    const { controller } = this;
    const form = setupForm(this.store, controller);
    form.decision.documentLinks = ['', '  '];
    this.submit.rejects(new ChangeRequestError('Nee.', { status: 403 }));

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.false(controller.hasValidationErrors, 'no "sparse array" error');
    assert.deepEqual(form.decision.documentLinks, []);
    const records = this.submit.firstCall.args[2];
    assert.notOk(
      records.some((record) => record.constructor.modelName === 'decision'),
      'no empty besluit',
    );
    assert.strictEqual(await form.changeEvent.decision, null);
  });

  test('another attempt after a refusal sends the same records', async function (assert) {
    const { controller } = this;
    const form = setupForm(this.store, controller);
    this.submit.rejects(
      new ChangeRequestError('Het adres is ongeldig.', { status: 422 }),
    );

    await controller.submitRequestTask.perform({ preventDefault() {} });
    const firstResult = this.submit.firstCall.args[2].find(
      (record) => record.constructor.modelName === 'change-event-result',
    );
    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.strictEqual(controller.saveError, 'Het adres is ongeldig.');
    assert.false(controller.saveBlocked);
    const [first, second] = this.submit.getCalls().map((call) => call.args[2]);
    assert.deepEqual(
      second.map((record) => record.constructor.modelName),
      first.map((record) => record.constructor.modelName),
    );
    assert.true(firstResult.isDestroying, 'the first result is dropped');
    assert.strictEqual((await form.primarySite.contacts).length, 2);
    assert.strictEqual((await form.organization.identifiers).length, 1);
    assert.strictEqual(
      (await form.changeEvent.resultingOrganizations).length,
      1,
    );
  });

  test('when the outcome is unknown nothing can be sent until the page is reloaded', async function (assert) {
    const { controller } = this;
    setupForm(this.store, controller);
    this.submit.rejects(
      new ChangeRequestError('De wijziging kon niet verwerkt worden.', {
        status: 504,
      }),
    );

    await controller.submitRequestTask.perform({ preventDefault() {} });
    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(this.submit.calledOnce, 'the second attempt sends nothing');
    assert.true(controller.saveBlocked);
    assert.true(controller.saveError.includes('Alle aanvragen'));
    assert.true(this.replaceWith.notCalled);

    controller.reset();
    assert.false(controller.saveBlocked);
  });

  test("ABB's request that was applied but not followed up, or whose apply failed, goes to the request", async function (assert) {
    const { controller } = this;
    this.changeRequests.rights = { canDecide: true, canCreate: [] };
    const warning = sinon.stub(this.owner.lookup('service:toaster'), 'warning');
    setupForm(this.store, controller);
    this.submit.rejects(
      new ChangeRequestError('De wijziging is doorgevoerd, maar ...', {
        status: 201,
        applied: true,
        requestId: REQUEST_ID,
      }),
    );

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(
      this.replaceWith.calledOnceWithExactly('aanvragen.aanvraag', REQUEST_ID),
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
      this.replaceWith.calledOnceWithExactly('aanvragen.aanvraag', REQUEST_ID),
    );
  });

  test("ABB's own request that waits over changed data goes to the request with a notice for ABB", async function (assert) {
    const { controller } = this;
    this.changeRequests.rights = { canDecide: true, canCreate: [] };
    const warning = sinon.stub(this.owner.lookup('service:toaster'), 'warning');
    setupForm(this.store, controller);
    this.submit.rejects(
      new ChangeRequestError('De aanvraag wacht.', {
        status: 201,
        held: true,
        waiting: true,
        requestId: REQUEST_ID,
        conflicts: [{ resource: { type: 'sites', id: 's-1' }, key: 'address' }],
      }),
    );

    await controller.submitRequestTask.perform({ preventDefault() {} });

    assert.true(this.success.notCalled, 'not "gevalideerd door ABB"');
    assert.true(warning.calledOnce);
    assert.true(warning.firstCall.args[0].includes('keur de aanvraag goed'));
    assert.true(
      this.replaceWith.calledOnceWithExactly('aanvragen.aanvraag', REQUEST_ID),
    );
  });

  test('kboConflictMessage reads the 409 of the service', function (assert) {
    assert.strictEqual(kboConflictMessage([]), null);
    assert.strictEqual(
      kboConflictMessage([{ meta: { status: 'afgekeurd' } }]),
      null,
    );
    assert.strictEqual(
      kboConflictMessage([
        { meta: { 'kbo-number': '1', 'change-request': { id: 'x' } } },
      ]),
      'Er wacht al een aanvraag voor een organisatie met dit KBO-nummer.',
    );
  });
});
