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

/**
 * The uuid of a change request the service kept.
 */
const REQUEST_ID = '6b8ed552-2bfb-417f-bf1e-4a1da50781aa';

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
      const toaster = this.owner.lookup('service:toaster');
      this.warning = sinon.stub(toaster, 'warning');
      this.success = sinon.stub(toaster, 'success');
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

    /**
     * The model of the route for a municipality with a primary site, its
     * address and primary contact point, but without a secondary contact
     * point and without a SharePoint identifier: the route creates those as
     * placeholders (and adds the identifier to `organization.identifiers`).
     */
    this.coreDataModelWithPlaceholders = async function () {
      const [organization, site, address, contact] = this.store.push({
        data: [
          {
            type: 'organization',
            id: 'org-2',
            attributes: { name: 'Gemeente Twee', legalName: 'Gemeente Twee' },
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
                data: [{ type: 'identifier', id: 'identifier-kbo' }],
              },
              primarySite: { data: { type: 'site', id: 'site-2' } },
              sites: { data: [] },
              contentThemes: { data: [] },
              additionalQualifications: { data: [] },
            },
          },
          {
            type: 'site',
            id: 'site-2',
            relationships: {
              address: { data: { type: 'address', id: 'address-2' } },
              contacts: {
                data: [{ type: 'contact-point', id: 'contact-2' }],
              },
            },
          },
          {
            type: 'address',
            id: 'address-2',
            attributes: {
              street: 'Markt',
              number: '1',
              postcode: '9300',
              municipality: 'Aalst',
              province: 'Oost-Vlaanderen',
              country: 'België',
              fullAddress: 'Markt 1, 9300 Aalst, België',
            },
          },
          {
            type: 'contact-point',
            id: 'contact-2',
            attributes: { email: 'info@aalst.be', type: 'Primary' },
          },
        ],
      });
      this.owner.register(
        'route:organizations/organization/core-data/edit',
        EditRoute,
      );
      const route = this.owner.lookup(
        'route:organizations/organization/core-data/edit',
      );
      const identifiers = await organization.identifiers;
      identifiers.push(...route.createMissingIdentifiers(identifiers));
      const identifierKBO = identifiers.find(
        ({ idName }) => idName === ID_NAME.KBO,
      );
      const identifierSharepoint = identifiers.find(
        ({ idName }) => idName === ID_NAME.SHAREPOINT,
      );

      return {
        organization,
        site,
        address,
        contact,
        secondaryContact: createSecondaryContact(this.store),
        identifierKBO,
        identifierSharepoint,
        structuredIdentifierKBO: await identifierKBO.structuredIdentifier,
        structuredIdentifierSharepoint:
          await identifierSharepoint.structuredIdentifier,
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
          primarySite,
          structuredIdentifierKBO,
          identifierKBO,
          structuredIdentifierSharepoint,
          identifierSharepoint,
          organization,
        ],
        'dependencies come first: the address and the contact point, then the site, then the organisation; the secondary contact point the user left empty stays out',
      );
      assert.strictEqual(primarySite.belongsTo('address').value(), address);
      assert.deepEqual(primarySite.hasMany('contacts').value().slice(), [
        contact,
      ]);
      assert.true(secondaryContact.isNew);
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

    test('it names the fields someone else changed and rebuilds the form when the service holds the request', async function (assert) {
      const { organization, structuredIdentifierSharepoint } =
        this.controller.model;
      organization.legalName = 'Stad Test';
      structuredIdentifierSharepoint.localId = '42';
      this.submit.rejects(
        new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
          status: 201,
          held: true,
          requestId: REQUEST_ID,
          conflicts: [
            {
              resource: { type: 'administrative-units', id: 'org-1' },
              key: 'legal-name',
              base: 'Gemeente Test',
              current: 'Gemeente Test-Oost',
              proposed: 'Stad Test',
              'competing-requests': [],
            },
            {
              resource: {
                type: 'structured-identifiers',
                id: 'structured-sharepoint',
              },
              key: 'local-id',
              base: null,
              current: '41',
              proposed: '42',
              'competing-requests': [],
            },
            {
              resource: { type: 'identifiers', id: 'identifier-kbo' },
              key: 'id-name',
              base: 'KBO nummer',
              current: 'KBO',
              proposed: 'KBO nummer',
              'competing-requests': [],
            },
          ],
        }),
      );
      // Refreshing the route resets this controller, as the edit route's
      // willTransition does
      const revision = this.controller.formRevision;
      this.refresh.callsFake(async () => {
        this.controller.reset();
        assert.strictEqual(
          this.controller.formRevision,
          revision,
          'the form is not rebuilt before the records are reloaded',
        );
      });

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(
        this.refresh.calledOnceWithExactly(
          'organizations.organization.core-data',
        ),
        'the route that loads the organisation with everything the form shows is refreshed',
      );
      assert.strictEqual(
        this.controller.formRevision,
        revision + 1,
        'the form is built anew from the reloaded records',
      );
      assert.deepEqual(
        this.controller.heldRequest,
        {
          id: REQUEST_ID,
          fields: ['Juridische naam', 'SharePoint identificator', 'id-name'],
          reloadFailed: false,
        },
        'the request, to withdraw it, and the labels of the page, the key for a field without one',
      );
      assert.true(this.transitionTo.notCalled, 'the page stays');
      assert.true(this.warning.notCalled, 'no toast that suggests success');
      assert.true(
        this.fetch.notCalled,
        'no KBO sync without an applied request',
      );
      assert.strictEqual(this.controller.saveError, null);
      assert.false(this.controller.saveBlocked, 'saving again is allowed');

      // Leaving the page clears the notice
      this.controller.reset();

      assert.strictEqual(this.controller.heldRequest, null);
    });

    test('it blocks saving until a reload when the records of a held request could not be reloaded', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.submit.rejects(
        new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
          status: 201,
          held: true,
          requestId: REQUEST_ID,
          reloadFailed: true,
          cause: new Error('502 Bad Gateway'),
        }),
      );
      this.refresh.callsFake(async () => this.controller.reset());

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(this.controller.heldRequest.reloadFailed);
      assert.true(
        this.controller.saveBlocked,
        'a new save would start from the values the page loaded',
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(this.submit.calledOnce, 'a second save sends nothing');
    });

    test('it reports the held request in a toast when the page cannot be refreshed', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.submit.rejects(
        new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
          status: 201,
          held: true,
          requestId: REQUEST_ID,
        }),
      );
      // The model hook fails: the router shows the error page
      this.refresh.rejects(new Error('502 Bad Gateway'));
      sinon.stub(console, 'warn');
      const revision = this.controller.formRevision;

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(
        this.warning.calledOnceWith(
          sinon.match('Je aanvraag wacht op een beslissing van ABB.'),
          'Wijziging niet doorgevoerd',
        ),
        'the toast outlives the page',
      );
      assert.strictEqual(this.controller.heldRequest, null);
      assert.strictEqual(this.controller.formRevision, revision);
    });

    test('it blocks saving and offers to apply the request again when its apply failed', async function (assert) {
      const { organization } = this.controller.model;
      organization.legalName = 'Stad Test';
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet doorgevoerd worden.', {
          status: 409,
          applyFailed: true,
          requestId: REQUEST_ID,
        }),
      );
      const reapply = sinon
        .stub(this.owner.lookup('service:change-requests'), 'reapply')
        .resolves();

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'De wijziging kon niet doorgevoerd worden.',
      );
      assert.true(this.controller.saveBlocked);
      assert.strictEqual(this.controller.failedRequestId, REQUEST_ID);
      assert.true(this.transitionTo.notCalled);
      assert.true(organization.hasDirtyAttributes, 'the edits are kept');

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(
        this.submit.calledOnce,
        'a new request would conflict with what the failed apply left',
      );

      await this.controller.reapply.perform();

      assert.true(reapply.calledOnceWithExactly(REQUEST_ID));
      assert.true(
        this.fetch.calledOnceWith('/kbo-data-sync/structured-kbo', {
          method: 'POST',
        }),
        'the KBO data is synced, as after a save',
      );
      assert.true(this.success.calledOnce);
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.core-data',
          'org-1',
        ),
        'the page is left, as after a save',
      );
    });

    test('an apply that fails again can be tried again; one the service refuses needs a reload', async function (assert) {
      this.controller.saveBlocked = true;
      this.controller.failedRequestId = REQUEST_ID;
      const reapply = sinon.stub(
        this.owner.lookup('service:change-requests'),
        'reapply',
      );
      reapply.rejects(
        new ChangeRequestError('Opnieuw mislukt.', {
          status: 409,
          applyFailed: true,
          requestId: REQUEST_ID,
        }),
      );

      await this.controller.reapply.perform();

      assert.strictEqual(this.controller.saveError, 'Opnieuw mislukt.');
      assert.strictEqual(this.controller.failedRequestId, REQUEST_ID);

      // The step did not reach the service
      reapply.rejects(
        new ChangeRequestError('De wijziging kon niet verstuurd worden.'),
      );

      await this.controller.reapply.perform();

      assert.strictEqual(
        this.controller.failedRequestId,
        REQUEST_ID,
        'it can be tried again',
      );

      reapply.rejects(
        new ChangeRequestError('Herlaad de pagina.', { status: 409 }),
      );

      await this.controller.reapply.perform();

      assert.strictEqual(this.controller.saveError, 'Herlaad de pagina.');
      assert.strictEqual(
        this.controller.failedRequestId,
        null,
        'no request to apply again',
      );
      assert.true(this.controller.saveBlocked, 'saving needs a reload');
      assert.true(this.transitionTo.notCalled);

      this.controller.reset();

      assert.false(this.controller.saveBlocked);
    });

    test('it leaves the contact point and the SharePoint identifier the route created out of the request when the user left them empty', async function (assert) {
      this.owner
        .lookup('service:features')
        .setup({ 'edit-contact-data': true, 'legal-form-editable': false });
      this.controller.model = await this.coreDataModelWithPlaceholders();
      const {
        organization,
        site,
        identifierKBO,
        structuredIdentifierKBO,
        secondaryContact,
        identifierSharepoint,
      } = this.controller.model;
      organization.legalName = 'Stad Twee';
      this.submit.resolves(
        new Map([[structuredIdentifierKBO, structuredIdentifierKBO]]),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.notOk(this.controller.hasValidationErrors);
      assert.deepEqual(
        this.submit.firstCall.args[2],
        [structuredIdentifierKBO, identifierKBO, organization],
        'neither the placeholders nor the site, whose contact points nobody changed',
      );
      assert.deepEqual(site.hasMany('contacts').ids(), ['contact-2']);
      assert.true(secondaryContact.isNew);
      assert.true(identifierSharepoint.isNew);
    });

    test('it submits and links the contact point and the SharePoint identifier the route created once the user filled them in', async function (assert) {
      this.owner
        .lookup('service:features')
        .setup({ 'edit-contact-data': true, 'legal-form-editable': false });
      this.controller.model = await this.coreDataModelWithPlaceholders();
      const {
        organization,
        site,
        identifierKBO,
        structuredIdentifierKBO,
        contact,
        secondaryContact,
        identifierSharepoint,
        structuredIdentifierSharepoint,
      } = this.controller.model;
      secondaryContact.telephone = '+3253779300';
      structuredIdentifierSharepoint.localId = '42';
      this.submit.resolves(
        new Map([[structuredIdentifierKBO, structuredIdentifierKBO]]),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.notOk(this.controller.hasValidationErrors);
      assert.deepEqual(this.submit.firstCall.args[2], [
        secondaryContact,
        site,
        structuredIdentifierKBO,
        identifierKBO,
        structuredIdentifierSharepoint,
        identifierSharepoint,
        organization,
      ]);
      assert.deepEqual(site.hasMany('contacts').value().slice(), [
        contact,
        secondaryContact,
      ]);
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
