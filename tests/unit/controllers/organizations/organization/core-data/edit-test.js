import { module, test } from 'qunit';
import sinon from 'sinon';
import { pluralize } from '@warp-drive/utilities/string';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import EditController from 'frontend-organization-portal/controllers/organizations/organization/core-data/edit';
import EditRoute from 'frontend-organization-portal/routes/organizations/organization/core-data/edit';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { ScopeOfOperationError } from 'frontend-organization-portal/services/scope-of-operation';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';
import { createAddress } from 'frontend-organization-portal/models/address';
import {
  createPrimaryContact,
  createSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

module(
  'Unit | Controller | organizations/organization/core-data/edit',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are built into a lazy bundle (`splitAtRoutes`
    // in ember-cli-build.js), so the controller must be registered before the
    // owner can look it up.
    hooks.beforeEach(function () {
      this.owner.register(
        'controller:organizations/organization/core-data/edit',
        EditController,
      );
      this.store = this.owner.lookup('service:store');
      this.submit = sinon.stub(
        this.owner.lookup('service:change-requests'),
        'submit',
      );
      const router = this.owner.lookup('service:router');
      this.refresh = sinon.stub(router, 'refresh');
      this.transitionTo = sinon.stub(router, 'transitionTo');
      this.warning = sinon.stub(
        this.owner.lookup('service:toaster'),
        'warning',
      );
      this.fetch = sinon.stub(window, 'fetch').resolves(new Response(null));
      this.controller = this.owner.lookup(
        'controller:organizations/organization/core-data/edit',
      );
      this.controller.model = this.coreDataModel();
      this.controller.locationsInScope = [];
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    /**
     * The model of the route for a municipality without primary site: the
     * persisted organisation with its identifiers, plus the new address and
     * contact points the route creates when the organisation has none.
     */
    this.coreDataModel = function () {
      const [
        organization,
        ,
        ,
        ,
        identifierKBO,
        structuredIdentifierKBO,
        identifierSharepoint,
        structuredIdentifierSharepoint,
      ] = this.store.push({
        data: [
          {
            type: 'organization',
            id: 'org-1',
            attributes: { name: 'Gemeente Test', legalName: 'Gemeente Test' },
            relationships: {
              classification: {
                data: {
                  type: 'administrative-unit-classification-code',
                  id: CLASSIFICATION.MUNICIPALITY.id,
                },
              },
              organizationStatus: {
                data: { type: 'organization-status-code', id: 'status-1' },
              },
              legalForm: { data: { type: 'concept', id: 'legal-form-1' } },
              identifiers: {
                data: [
                  { type: 'identifier', id: 'identifier-kbo' },
                  { type: 'identifier', id: 'identifier-sharepoint' },
                ],
              },
              primarySite: { data: null },
              sites: { data: [] },
              contentThemes: { data: [] },
              additionalQualifications: { data: [] },
            },
          },
          {
            type: 'administrative-unit-classification-code',
            id: CLASSIFICATION.MUNICIPALITY.id,
            attributes: { label: 'Gemeente' },
          },
          {
            type: 'organization-status-code',
            id: 'status-1',
            attributes: { label: 'Actief' },
          },
          {
            type: 'concept',
            id: 'legal-form-1',
            attributes: { label: 'Gemeente' },
          },
          {
            type: 'identifier',
            id: 'identifier-kbo',
            attributes: { idName: ID_NAME.KBO },
            relationships: {
              structuredIdentifier: {
                data: { type: 'structured-identifier', id: 'structured-kbo' },
              },
            },
          },
          {
            type: 'structured-identifier',
            id: 'structured-kbo',
            attributes: { localId: '0123456789' },
          },
          {
            type: 'identifier',
            id: 'identifier-sharepoint',
            attributes: { idName: ID_NAME.SHAREPOINT },
            relationships: {
              structuredIdentifier: {
                data: {
                  type: 'structured-identifier',
                  id: 'structured-sharepoint',
                },
              },
            },
          },
          {
            type: 'structured-identifier',
            id: 'structured-sharepoint',
            attributes: { localId: null },
          },
        ],
      });

      return {
        organization,
        address: createAddress(this.store),
        contact: createPrimaryContact(this.store),
        secondaryContact: createSecondaryContact(this.store),
        identifierKBO,
        identifierSharepoint,
        structuredIdentifierKBO,
        structuredIdentifierSharepoint,
        regions: [],
        vendors: [],
      };
    };

    test('it submits the identifiers and the organisation as one change request', async function (assert) {
      const {
        organization,
        identifierKBO,
        identifierSharepoint,
        structuredIdentifierKBO,
        structuredIdentifierSharepoint,
      } = this.controller.model;
      organization.name = 'Stad Test';
      organization.legalName = 'Stad Test';
      organization.purpose = '';
      this.submit.resolves(
        new Map([[structuredIdentifierKBO, structuredIdentifierKBO]]),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.notOk(this.controller.hasValidationErrors);
      assert.true(this.submit.calledOnce);
      const [aggregate, target, records] = this.submit.firstCall.args;
      assert.strictEqual(aggregate, 'organization-core-data');
      assert.strictEqual(target, 'org-1');
      assert.deepEqual(
        records,
        [
          structuredIdentifierKBO,
          identifierKBO,
          structuredIdentifierSharepoint,
          identifierSharepoint,
          organization,
        ],
        'the contact data of a municipality is not editable, so the address, contact points and site stay out',
      );
      assert.strictEqual(
        organization.purpose,
        null,
        'empty strings become null',
      );
      assert.true(
        this.fetch.calledOnceWith('/kbo-data-sync/structured-kbo', {
          method: 'POST',
        }),
        'the KBO data is synced for the structured identifier',
      );
      assert.true(this.refresh.calledOnce);
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.core-data',
          'org-1',
        ),
      );
      assert.strictEqual(this.controller.saveError, null);
    });

    test('it creates the primary site with the address and contact points when the contact data is editable', async function (assert) {
      this.owner
        .lookup('service:features')
        .setup({ 'edit-contact-data': true, 'legal-form-editable': false });
      const {
        organization,
        address,
        contact,
        secondaryContact,
        identifierKBO,
        identifierSharepoint,
        structuredIdentifierKBO,
        structuredIdentifierSharepoint,
      } = this.controller.model;
      Object.assign(address, {
        street: 'Kerkstraat',
        number: '1',
        postcode: '9000',
        municipality: 'Gent',
        province: 'Oost-Vlaanderen',
        country: 'België',
      });
      contact.email = 'info@test.be';
      this.submit.resolves(
        new Map([[structuredIdentifierKBO, structuredIdentifierKBO]]),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.notOk(this.controller.hasValidationErrors);
      assert.true(this.submit.calledOnce);
      const records = this.submit.firstCall.args[2];
      const primarySite = organization.belongsTo('primarySite').value();
      assert.ok(primarySite, 'a primary site is created');
      assert.true(primarySite.isNew);
      assert.deepEqual(
        records,
        [
          address,
          contact,
          secondaryContact,
          primarySite,
          structuredIdentifierKBO,
          identifierKBO,
          structuredIdentifierSharepoint,
          identifierSharepoint,
          organization,
        ],
        'dependencies come first: the address and contact points, then the site, then the organisation',
      );
      assert.strictEqual(primarySite.belongsTo('address').value(), address);
      assert.deepEqual(primarySite.hasMany('contacts').value().slice(), [
        contact,
        secondaryContact,
      ]);
      assert.strictEqual(
        address.fullAddress,
        'Kerkstraat 1, 9000 Gent, België',
      );
    });

    test('it does not submit when a validation fails', async function (assert) {
      this.controller.model.organization.legalName = '';

      await this.controller.save.perform({ preventDefault() {} });

      assert.ok(this.controller.hasValidationErrors);
      assert.strictEqual(
        this.controller.model.organization.error.legalName.message,
        'Vul de juridische naam in',
      );
      assert.true(this.submit.notCalled);
      assert.true(this.transitionTo.notCalled);
    });

    test('it shows the message of the service and keeps the edits when the request is refused', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.submit.rejects(
        new ChangeRequestError('U mag deze organisatie niet bewerken.', {
          status: 403,
        }),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'U mag deze organisatie niet bewerken.',
      );
      assert.true(
        this.fetch.notCalled,
        'no KBO sync without an applied request',
      );
      assert.true(this.transitionTo.notCalled);
      assert.strictEqual(organization.legalName, 'Stad Test');
      assert.true(organization.hasDirtyAttributes);

      // Leaving the page discards the edits
      this.controller.reset();

      assert.strictEqual(organization.legalName, 'Gemeente Test');
      assert.false(organization.hasDirtyAttributes);
      assert.strictEqual(this.controller.saveError, null);
    });

    test('it sends the request of an organisation that lacks NIS and OVO identifiers without the placeholder identifiers the route adds', async function (assert) {
      const { organization, identifierKBO, identifierSharepoint } =
        this.controller.model;
      // The route adds a new identifier for every missing name to
      // organization.identifiers; this organisation lacks NIS and OVO.
      this.owner.register(
        'route:organizations/organization/core-data/edit',
        EditRoute,
      );
      const route = this.owner.lookup(
        'route:organizations/organization/core-data/edit',
      );
      const identifiers = await organization.identifiers;
      identifiers.push(...route.createMissingIdentifiers(identifiers));
      assert.strictEqual(identifiers.length, 4);
      organization.legalName = 'Stad Test';

      // The real submit, with the backend stubbed
      this.submit.callThrough();
      this.fetch.callsFake(async (url) => {
        if (url === '/change-requests') {
          return jsonResponse(201, {
            data: {
              type: 'change-requests',
              id: 'request-1',
              attributes: {
                status: 'goedgekeurd',
                aggregate: 'organization-core-data',
                lids: {},
              },
            },
          });
        }
        return new Response(null);
      });
      sinon
        .stub(this.owner.lookup('adapter:application'), 'findRecord')
        .callsFake((store, schema, id) =>
          Promise.resolve({
            data: { type: pluralize(schema.modelName), id, attributes: {} },
          }),
        );

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(this.controller.saveError, null);
      const request = this.fetch
        .getCalls()
        .find((call) => call.args[0] === '/change-requests');
      assert.ok(request, 'the change request is posted');
      const { data } = JSON.parse(request.args[1].body);
      const organizationOp = data.attributes.operations.at(-1).data;
      assert.strictEqual(organizationOp.attributes['legal-name'], 'Stad Test');
      assert.deepEqual(
        organizationOp.relationships.identifiers.data,
        [
          { type: 'identifiers', id: identifierKBO.id },
          { type: 'identifiers', id: identifierSharepoint.id },
        ],
        'only the persisted identifiers; the placeholders for NIS and OVO are left out',
      );
      assert.true(this.transitionTo.calledOnce, 'the page is left');
    });

    test('it leaves the page with a warning when the request was applied but could not be followed up', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.submit.rejects(
        new ChangeRequestError(
          'De wijziging is doorgevoerd, maar de pagina kon niet vernieuwd worden.',
          { status: 201, applied: true },
        ),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(this.controller.saveError, null);
      assert.false(this.controller.saveBlocked);
      assert.true(
        this.warning.calledOnceWith(
          'De wijziging is doorgevoerd, maar de pagina kon niet vernieuwd worden.',
        ),
      );
      assert.true(this.refresh.calledOnce);
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.core-data',
          'org-1',
        ),
      );
    });

    test('it blocks a retry when the outcome of the request is unknown', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet verwerkt worden.', {
          status: 504,
        }),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'De wijziging kon niet verwerkt worden.',
      );
      assert.true(this.controller.saveBlocked);
      assert.true(this.transitionTo.notCalled);
      assert.strictEqual(organization.legalName, 'Stad Test');

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(this.submit.calledOnce, 'a second save sends nothing');

      this.controller.reset();

      assert.false(this.controller.saveBlocked);
    });

    test('it leaves the werkingsgebied untouched when its locations could not be loaded', async function (assert) {
      const { organization, structuredIdentifierKBO } = this.controller.model;
      const scope = { id: 'location-1' };
      organization.scope = scope;
      organization.legalName = 'Stad Test';
      this.controller.locationsInScope = null;
      const getScopeForLocations = sinon.stub(
        this.owner.lookup('service:scope-of-operation'),
        'getScopeForLocations',
      );
      this.submit.resolves(
        new Map([[structuredIdentifierKBO, structuredIdentifierKBO]]),
      );

      assert.true(this.controller.scopeNotLoaded);

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(getScopeForLocations.notCalled);
      assert.strictEqual(organization.scope, scope, 'the scope is kept');
      assert.true(this.submit.calledOnce);
    });

    test('it stops with a message when the werkingsgebied cannot be resolved', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.controller.locationsInScope = [{ id: 'location-1' }];
      sinon
        .stub(
          this.owner.lookup('service:scope-of-operation'),
          'getScopeForLocations',
        )
        .rejects(
          new ScopeOfOperationError(
            'Het werkingsgebied kon niet bepaald worden.',
          ),
        );

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'Het werkingsgebied kon niet bepaald worden.',
      );
      assert.true(this.submit.notCalled, 'nothing is sent');
      assert.true(this.transitionTo.notCalled);
    });
  },
);
