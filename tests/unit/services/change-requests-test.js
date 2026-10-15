import { module, test } from 'qunit';
import sinon from 'sinon';
import { pluralize } from '@warp-drive/utilities/string';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import CoreDataEditRoute from 'frontend-organization-portal/routes/organizations/organization/core-data/edit';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import {
  createPrimaryContact,
  createSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

/**
 * A promise to resolve by hand, for answers that must arrive in a chosen
 * order.
 */
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

module('Unit | Service | change-requests', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.fetch = sinon.stub(window, 'fetch');
    this.store = this.owner.lookup('service:store');
    this.adapter = this.owner.lookup('adapter:application');
    this.service = this.owner.lookup('service:change-requests');
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  /**
   * A persisted organisation without primary site, as the sites/new route
   * would have loaded it, plus the new site with its address and contact
   * points.
   */
  function newSiteForOrganization(store) {
    const [organization, siteType] = store.push({
      data: [
        {
          type: 'organization',
          id: 'org-1',
          attributes: { name: 'Gemeente Test', legalName: 'Gemeente Test' },
          relationships: {
            primarySite: { data: null },
            sites: { data: [] },
          },
        },
        {
          type: 'site-type',
          id: 'site-type-1',
          attributes: { label: 'Hoofdzetel' },
        },
      ],
    });
    const address = store.createRecord('address', {
      street: 'Kerkstraat',
      number: '1',
      postcode: '9000',
      municipality: 'Gent',
      country: 'België',
    });
    const contact = createPrimaryContact(store);
    contact.email = 'info@gent.be';
    const secondaryContact = createSecondaryContact(store);
    const site = store.createRecord('site', {
      siteType,
      address,
      contacts: [contact, secondaryContact],
    });

    return { organization, site, address, contact, secondaryContact };
  }

  /**
   * Answer a POST /change-requests like the service does: 201 with a uuid for
   * every lid of the request.
   */
  function acceptRequests(fetchStub, mintedIds) {
    fetchStub.callsFake(async (url, options) => {
      const body = JSON.parse(options.body);
      const lids = {};
      body.data.attributes.operations
        .filter((operation) => operation.op === 'create')
        .forEach((operation) => {
          lids[operation.data.lid] =
            `${operation.data.type}-${Object.keys(lids).length + 1}`;
          mintedIds[operation.data.lid] = lids[operation.data.lid];
        });
      return jsonResponse(201, {
        data: {
          type: 'change-requests',
          id: 'request-1',
          attributes: {
            status: 'goedgekeurd',
            aggregate: body.data.attributes.aggregate,
            lids,
          },
        },
      });
    });
  }

  /**
   * Answer the reloads with a minimal applied state.
   */
  function acceptReloads(adapter) {
    return sinon.stub(adapter, 'findRecord').callsFake((store, schema, id) =>
      Promise.resolve({
        data: { type: pluralize(schema.modelName), id, attributes: {} },
      }),
    );
  }

  module('submit', function () {
    test('it posts the aggregate with lids for the new records and reloads them under the minted ids', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      organization.primarySite = site;
      organization.name = 'Stad Gent';

      const mintedIds = {};
      acceptRequests(this.fetch, mintedIds);
      // The backend answers the reloads with the applied state
      const reloads = sinon.stub(this.adapter, 'findRecord');
      reloads.callsFake((store, schema, id, snapshot) => {
        const payload = {
          data: { type: pluralize(schema.modelName), id, attributes: {} },
        };
        if (schema.modelName === 'organization') {
          const siteId = Object.values(mintedIds).find((mintedId) =>
            mintedId.startsWith('sites-'),
          );
          payload.data.attributes.name = 'Stad Gent';
          payload.data.relationships = {
            'primary-site': { data: { type: 'sites', id: siteId } },
          };
          // What the organisation was reloaded with
          assert.step(`reload organization include=${snapshot.include}`);
        } else {
          assert.step(`reload ${schema.modelName} ${id}`);
        }
        return Promise.resolve(payload);
      });

      const saved = await this.service.submit('site', organization.id, [
        contact,
        secondaryContact,
        address,
        site,
        organization,
      ]);

      // The request
      assert.true(this.fetch.calledOnce);
      const [url, options] = this.fetch.firstCall.args;
      assert.strictEqual(url, '/change-requests');
      assert.strictEqual(options.method, 'POST');
      assert.strictEqual(
        options.headers['Content-Type'],
        'application/vnd.api+json',
      );
      const { data } = JSON.parse(options.body);
      assert.strictEqual(data.type, 'change-requests');
      assert.strictEqual(data.attributes.aggregate, 'site');
      assert.deepEqual(data.relationships.target.data, {
        type: 'organizations',
        id: 'org-1',
      });

      const operations = data.attributes.operations;
      assert.deepEqual(
        operations.map(({ op, data }) => [op, data.type]),
        [
          ['create', 'contact-points'],
          ['create', 'contact-points'],
          ['create', 'addresses'],
          ['create', 'sites'],
          ['update', 'organizations'],
        ],
        'the operations keep the order of the records',
      );
      const [contactOp, secondaryContactOp, addressOp, siteOp, organizationOp] =
        operations.map(({ data }) => data);
      for (const created of [
        contactOp,
        secondaryContactOp,
        addressOp,
        siteOp,
      ]) {
        assert.true(
          UUID_PATTERN.test(created.lid),
          `${created.type} has a lid`,
        );
        assert.notOk(created.id, 'a new record has no id');
      }
      assert.strictEqual(contactOp.attributes.email, 'info@gent.be');
      assert.strictEqual(contactOp.attributes.type, 'Primary');
      assert.strictEqual(addressOp.attributes.street, 'Kerkstraat');
      assert.deepEqual(
        siteOp.relationships.address.data,
        { type: 'addresses', lid: addressOp.lid },
        'a new record is referenced by its lid',
      );
      assert.deepEqual(
        siteOp.relationships['site-type'].data,
        { type: 'site-types', id: 'site-type-1' },
        'a persisted record is referenced by its id',
      );
      assert.deepEqual(siteOp.relationships.contacts.data, [
        { type: 'contact-points', lid: contactOp.lid },
        { type: 'contact-points', lid: secondaryContactOp.lid },
      ]);
      assert.strictEqual(organizationOp.id, 'org-1');
      assert.strictEqual(organizationOp.attributes.name, 'Stad Gent');
      assert.deepEqual(organizationOp.relationships['primary-site'].data, {
        type: 'sites',
        lid: siteOp.lid,
      });

      // The store afterwards
      const siteId = mintedIds[siteOp.lid];
      assert.verifySteps(
        [
          `reload contact-point ${mintedIds[contactOp.lid]}`,
          `reload contact-point ${mintedIds[secondaryContactOp.lid]}`,
          `reload address ${mintedIds[addressOp.lid]}`,
          `reload site ${siteId}`,
          'reload organization include=primary-site',
        ],
        'every record is reloaded, the organisation with the relationship the request changed',
      );
      assert.true(site.isDestroying, 'the client-side new record is unloaded');
      assert.strictEqual(saved.get(site).id, siteId);
      assert.false(saved.get(site).isNew);
      assert.strictEqual(saved.get(organization), organization);
      assert.false(organization.hasDirtyAttributes);
      assert.strictEqual(organization.name, 'Stad Gent');
      assert.strictEqual(
        organization.belongsTo('primarySite').id(),
        siteId,
        'the organisation points at the site under its minted id',
      );
    });

    test('it keeps the records dirty and throws the message of the service when the request is refused', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      organization.primarySite = site;
      organization.name = 'Stad Gent';
      this.fetch.resolves(
        jsonResponse(422, {
          errors: [
            {
              status: '422',
              title: 'Unprocessable',
              detail: 'Het type addresses hoort niet bij het aggregaat site.',
            },
          ],
        }),
      );
      const reloads = sinon.stub(this.adapter, 'findRecord');

      let error;
      try {
        await this.service.submit('site', organization.id, [
          contact,
          secondaryContact,
          address,
          site,
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error instanceof ChangeRequestError);
      assert.strictEqual(
        error.message,
        'Het type addresses hoort niet bij het aggregaat site.',
      );
      assert.strictEqual(error.status, 422);
      assert.strictEqual(error.errors.length, 1);
      assert.false(error.applied);
      assert.false(error.outcomeUnknown);
      assert.true(reloads.notCalled, 'nothing is reloaded');
      assert.true(site.isNew);
      assert.false(site.isDestroying);
      assert.true(organization.hasDirtyAttributes);
      assert.strictEqual(organization.name, 'Stad Gent');
      assert.strictEqual(
        organization.belongsTo('primarySite').value(),
        site,
        'the relationship to the new record is kept',
      );
    });

    test('it refuses a relationship to a new record that is not part of the request', async function (assert) {
      const { organization, site, address } = newSiteForOrganization(
        this.store,
      );
      organization.primarySite = site;

      await assert.rejects(
        this.service.submit('site', organization.id, [address, organization]),
        /not part of the change request/,
      );
      assert.true(this.fetch.notCalled);
    });

    test('it leaves out the new members of a to-many relationship that are not part of the request, as the kerngegevens page leaves placeholder identifiers in organization.identifiers', async function (assert) {
      // A samenwerkingsverband with a KBO identifier only, as the dump has it
      const [organization] = this.store.push({
        data: [
          {
            type: 'administrative-unit',
            id: 'org-1',
            attributes: {
              name: 'Projectvereniging Test',
              legalName: 'Projectvereniging Test',
            },
            relationships: {
              classification: {
                data: {
                  type: 'administrative-unit-classification-code',
                  id: CLASSIFICATION.PROJECTVERENIGING.id,
                },
              },
              identifiers: {
                data: [{ type: 'identifier', id: 'identifier-kbo' }],
              },
              primarySite: { data: null },
              sites: { data: [] },
            },
          },
          {
            type: 'administrative-unit-classification-code',
            id: CLASSIFICATION.PROJECTVERENIGING.id,
            attributes: { label: 'Projectvereniging' },
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
        ],
      });

      // The route adds a new identifier for every missing name (SharePoint,
      // NIS, OVO) to organization.identifiers; the page submits only the KBO
      // and SharePoint ones.
      this.owner.register(
        'route:organizations/organization/core-data/edit',
        CoreDataEditRoute,
      );
      const route = this.owner.lookup(
        'route:organizations/organization/core-data/edit',
      );
      const identifiers = await organization.identifiers;
      identifiers.push(...route.createMissingIdentifiers(identifiers));
      const identifierSharepoint = identifiers.find(
        ({ idName }) => idName === ID_NAME.SHAREPOINT,
      );
      const structuredIdentifierSharepoint =
        await identifierSharepoint.structuredIdentifier;
      structuredIdentifierSharepoint.localId = '42';
      organization.name = 'Projectvereniging Test 2';

      const mintedIds = {};
      acceptRequests(this.fetch, mintedIds);
      acceptReloads(this.adapter);

      await this.service.submit('organization-core-data', organization.id, [
        structuredIdentifierSharepoint,
        identifierSharepoint,
        organization,
      ]);

      assert.true(this.fetch.calledOnce, 'the request is sent');
      const { data } = JSON.parse(this.fetch.firstCall.args[1].body);
      const operations = data.attributes.operations;
      assert.deepEqual(
        operations.map(({ op, data }) => [op, data.type]),
        [
          ['create', 'structured-identifiers'],
          ['create', 'identifiers'],
          ['update', 'administrative-units'],
        ],
        'the organisation is sent with the type of its subclass',
      );
      const [, identifierOp, organizationOp] = operations.map(
        ({ data }) => data,
      );
      assert.deepEqual(
        organizationOp.relationships.identifiers.data,
        [
          { type: 'identifiers', id: 'identifier-kbo' },
          { type: 'identifiers', lid: identifierOp.lid },
        ],
        'the persisted identifier by id, the submitted new one by lid, the placeholders left out',
      );
    });

    test('it marks the error as applied when the answer lacks the id of a new record', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      organization.primarySite = site;
      this.fetch.resolves(
        jsonResponse(201, {
          data: {
            type: 'change-requests',
            id: 'request-1',
            attributes: { status: 'goedgekeurd', aggregate: 'site', lids: {} },
          },
        }),
      );
      const reloads = sinon.stub(this.adapter, 'findRecord');

      let error;
      try {
        await this.service.submit('site', organization.id, [
          contact,
          secondaryContact,
          address,
          site,
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error instanceof ChangeRequestError);
      assert.true(error.applied);
      assert.false(error.outcomeUnknown);
      assert.strictEqual(error.status, 201);
      assert.true(this.fetch.calledOnce);
      assert.true(reloads.notCalled);
      assert.true(site.isNew, 'the store is not touched');
      assert.false(site.isDestroying);
    });

    test('it marks the error as applied when a reload fails after the service applied the request', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      organization.primarySite = site;
      acceptRequests(this.fetch, {});
      sinon.stub(this.adapter, 'findRecord').callsFake((store, schema, id) => {
        if (schema.modelName === 'site') {
          return Promise.reject(new Error('502 Bad Gateway'));
        }
        return Promise.resolve({
          data: { type: pluralize(schema.modelName), id, attributes: {} },
        });
      });

      let error;
      try {
        await this.service.submit('site', organization.id, [
          contact,
          secondaryContact,
          address,
          site,
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error instanceof ChangeRequestError);
      assert.true(error.applied);
      assert.strictEqual(error.status, 201);
      assert.true(
        error.message.includes('Herlaad de pagina'),
        'the message tells the user to reload',
      );
      assert.true(this.fetch.calledOnce, 'the request is sent once');
    });

    test('it blocks a retry when a 5xx leaves the outcome unknown', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      organization.primarySite = site;
      this.fetch.resolves(
        new Response('Gateway Timeout', {
          status: 504,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      let error;
      try {
        await this.service.submit('site', organization.id, [
          contact,
          secondaryContact,
          address,
          site,
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error instanceof ChangeRequestError);
      assert.strictEqual(error.status, 504);
      assert.false(error.applied);
      assert.true(error.outcomeUnknown);
      assert.true(error.message.includes('Herlaad de pagina'));
      assert.true(site.isNew, 'the edits are kept');
    });
  });

  module('permissions', function () {
    test('it returns whether the organisation may be edited and by which rules', async function (assert) {
      this.fetch.resolves(
        jsonResponse(200, { 'can-edit': true, rules: ['own-organisation'] }),
      );

      const permissions = await this.service.permissions('org-1');

      assert.strictEqual(
        this.fetch.firstCall.args[0],
        '/change-requests/permissions?target=org-1',
      );
      assert.deepEqual(permissions, {
        canEdit: true,
        rules: ['own-organisation'],
      });
    });

    test('it treats an organisation as read-only when the service does not answer', async function (assert) {
      this.fetch.resolves(jsonResponse(503, {}));
      sinon.stub(console, 'warn');

      const permissions = await this.service.permissions('org-1');

      assert.deepEqual(permissions, { canEdit: false, rules: [] });
    });

    test('it treats an organisation as read-only when the service cannot be reached', async function (assert) {
      this.fetch.rejects(new TypeError('Failed to fetch'));
      sinon.stub(console, 'warn');

      const permissions = await this.service.permissions('org-1');

      assert.deepEqual(permissions, { canEdit: false, rules: [] });
    });

    test('it treats an organisation as read-only when something else than the service answers', async function (assert) {
      this.fetch.resolves(
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );
      sinon.stub(console, 'warn');

      const permissions = await this.service.permissions('org-1');

      assert.deepEqual(permissions, { canEdit: false, rules: [] });
    });

    test('loadPermissions keeps the answer per organisation and canEdit follows the organisation on screen', async function (assert) {
      this.fetch.resolves(jsonResponse(200, { 'can-edit': true, rules: [] }));
      const currentSession = this.owner.lookup('service:current-session');

      assert.false(this.service.canEdit);
      assert.false(this.service.canEditOrganization('org-1'));

      await this.service.loadPermissions('org-1');

      assert.true(this.service.canEditOrganization('org-1'));
      assert.false(
        this.service.canEdit,
        'not on screen yet: a transition into the organisation is not committed',
      );

      this.service.enterOrganization('org-1');

      assert.true(this.service.canEdit);
      assert.true(
        currentSession.canEdit,
        'the session service reads the same answer',
      );

      this.service.leaveOrganization();

      assert.false(this.service.canEdit);
      assert.false(currentSession.canEdit);
      assert.true(
        this.service.canEditOrganization('org-1'),
        'the answer itself is kept for a next visit',
      );
    });

    test('a late answer for another organisation never shows on the pages of the one on screen', async function (assert) {
      const slow = deferred();
      this.fetch
        .withArgs('/change-requests/permissions?target=org-a')
        .returns(slow.promise);
      this.fetch
        .withArgs('/change-requests/permissions?target=org-b')
        .resolves(jsonResponse(200, { 'can-edit': false, rules: [] }));

      // Organisation A is opened, then B before A's answer is in
      const loadA = this.service.loadPermissions('org-a');
      await this.service.loadPermissions('org-b');
      this.service.enterOrganization('org-b');

      assert.false(this.service.canEdit);

      slow.resolve(
        jsonResponse(200, { 'can-edit': true, rules: ['own-organisation'] }),
      );
      await loadA;

      assert.false(
        this.service.canEdit,
        "A's late answer does not make B's pages editable",
      );
      assert.true(this.service.canEditOrganization('org-a'));
      assert.false(this.service.canEditOrganization('org-b'));

      // Leaving the organisation pages while an answer is pending
      this.service.leaveOrganization();
      const late = deferred();
      this.fetch
        .withArgs('/change-requests/permissions?target=org-a')
        .returns(late.promise);
      const loadAgain = this.service.loadPermissions('org-a');
      late.resolve(jsonResponse(200, { 'can-edit': true, rules: [] }));
      await loadAgain;

      assert.false(
        this.service.canEdit,
        'outside the organisation pages nothing is editable',
      );
    });

    test('only the latest answer for an organisation is kept', async function (assert) {
      const first = deferred();
      const second = deferred();
      this.fetch
        .withArgs('/change-requests/permissions?target=org-a')
        .onFirstCall()
        .returns(first.promise)
        .onSecondCall()
        .returns(second.promise);

      const loadFirst = this.service.loadPermissions('org-a');
      const loadSecond = this.service.loadPermissions('org-a');
      second.resolve(jsonResponse(200, { 'can-edit': false, rules: [] }));
      await loadSecond;
      first.resolve(
        jsonResponse(200, { 'can-edit': true, rules: ['own-organisation'] }),
      );
      await loadFirst;

      assert.false(
        this.service.canEditOrganization('org-a'),
        'the answer to the earlier request is dropped',
      );
    });
  });
});
