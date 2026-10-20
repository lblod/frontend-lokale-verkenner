import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import NewController, {
  kboConflictMessage,
} from 'frontend-organization-portal/controllers/organizations/new';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
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
    this.owner
      .lookup('service:features')
      .setup({ 'edit-contact-data': true, 'legal-form-editable': true });
    // The KBO uniqueness check of the identifier model queries the backend
    sinon
      .stub(this.owner.lookup('adapter:application'), 'query')
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
        'administrative-unit',
      ],
      'dependencies first, the organisation last; no SharePoint identifier without a value',
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

    assert.strictEqual(
      identifierKBO.error.structuredIdentifier.message,
      'Er bestaat al een organisatie met dit KBO-nummer.',
    );
    assert.strictEqual(
      controller.saveError,
      'KBO number 0123456789 belongs to organisation "org-2"',
    );
    assert.true(this.replaceWith.notCalled);
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
