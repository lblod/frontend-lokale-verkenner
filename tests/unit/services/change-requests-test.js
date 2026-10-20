import { module, test } from 'qunit';
import sinon from 'sinon';
import { pluralize } from '@warp-drive/utilities/string';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { setEmptyStringsToNull } from 'frontend-organization-portal/utils/empty-string-to-null';
import CoreDataEditRoute from 'frontend-organization-portal/routes/organizations/organization/core-data/edit';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import {
  createPrimaryContact,
  createSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/**
 * The uuid of a change request the service kept.
 */
const REQUEST_ID = '25e29be4-7c4e-4044-9357-2196fa23a17e';

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

/**
 * The error a promise rejects with, or null when it resolves.
 */
async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
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
            status: 'afgehandeld',
            aggregate: body.data.attributes.aggregate,
            lids,
          },
        },
      });
    });
  }

  /**
   * Load a record as the pages do: through the adapter and the serializer,
   * with its transforms, from the document the backend sends.
   */
  async function loadRecord(store, adapter, modelName, document) {
    const stub = sinon.stub(adapter, 'findRecord').resolves(document);
    try {
      const { content } = await store.request(
        findRecord(modelName, document.data.id),
      );
      return content;
    } finally {
      stub.restore();
    }
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
    test('when the save replaced earlier pending requests it tells the user they were withdrawn, and says nothing otherwise', async function (assert) {
      const toaster = this.owner.lookup('service:toaster');
      const success = sinon.stub(toaster, 'success');
      acceptReloads(this.adapter);
      const answer = (superseded) =>
        jsonResponse(201, {
          data: {
            type: 'change-requests',
            id: 'request-2',
            attributes: {
              status: 'afgehandeld',
              aggregate: 'organization-core-data',
              lids: {},
              ...(superseded ? { superseded } : {}),
            },
          },
        });
      const organization = () => {
        const [record] = this.store.push({
          data: [
            {
              type: 'organization',
              id: 'org-1',
              attributes: { name: 'Gemeente Test' },
            },
          ],
        });
        record.name = 'Stad Test';
        return record;
      };

      this.fetch.resolves(answer(['request-1']));
      await this.service.submit('organization-core-data', 'org-1', [
        organization(),
      ]);
      assert.true(success.calledOnce);
      assert.strictEqual(
        success.firstCall.args[1],
        'Eerdere aanvraag vervangen',
      );
      assert.strictEqual(
        success.firstCall.args[0],
        'Deze wijziging vervangt je eerdere aanvraag die nog op een beslissing van ABB wachtte. Die aanvraag is ingetrokken.',
      );

      this.fetch.resolves(answer(undefined));
      await this.service.submit('organization-core-data', 'org-1', [
        organization(),
      ]);
      assert.true(success.calledOnce, 'no message when nothing was replaced');
    });

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
            attributes: { status: 'afgehandeld', aggregate: 'site', lids: {} },
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

  module('base values', function () {
    /**
     * A persisted organisation with its primary site, legal form and status,
     * as the kerngegevens route would have loaded it, and a second site that
     * a test can link to it.
     */
    function loadOrganization(store) {
      const [organization, , otherSite] = store.push({
        data: [
          {
            type: 'organization',
            id: 'org-1',
            attributes: {
              name: 'Gemeente Test',
              legalName: 'Gemeente Test',
              alternativeName: ['Test'],
              purpose: null,
            },
            relationships: {
              primarySite: { data: { type: 'site', id: 'site-1' } },
              sites: { data: [{ type: 'site', id: 'site-1' }] },
              legalForm: { data: { type: 'concept', id: 'legal-form-1' } },
              organizationStatus: {
                data: { type: 'organization-status-code', id: 'status-1' },
              },
            },
          },
          { type: 'site', id: 'site-1', attributes: {} },
          { type: 'site', id: 'site-2', attributes: {} },
          { type: 'concept', id: 'legal-form-1', attributes: {} },
          { type: 'organization-status-code', id: 'status-1', attributes: {} },
        ],
      });
      return { organization, otherSite };
    }

    function postedOperations(fetchStub) {
      return JSON.parse(fetchStub.firstCall.args[1].body).data.attributes
        .operations;
    }

    test('an update carries the loaded value of every attribute it sends: the old value of a changed one, the current value of an unchanged one', async function (assert) {
      const { organization } = loadOrganization(this.store);
      const contact = await loadRecord(
        this.store,
        this.adapter,
        'contact-point',
        {
          data: {
            type: 'contact-points',
            id: 'contact-1',
            attributes: { telephone: 'tel:+3290000000', type: 'Primary' },
          },
        },
      );
      assert.strictEqual(contact.telephone, '+3290000000');
      organization.legalName = 'Stad Test';
      organization.alternativeName = ['Test', 'Stad Test'];
      contact.telephone = '+3291111111';
      acceptRequests(this.fetch, {});
      acceptReloads(this.adapter);

      await this.service.submit('organization-core-data', 'org-1', [
        contact,
        organization,
      ]);

      const [contactOp, organizationOp] = postedOperations(this.fetch).map(
        ({ data }) => data,
      );
      assert.deepEqual(
        organizationOp.meta.base.attributes,
        {
          name: 'Gemeente Test',
          'legal-name': 'Gemeente Test',
          'alternative-name': ['Test'],
          'expected-end-date': null,
          purpose: null,
        },
        'the legal and alternative names as loaded, the other attributes as they are',
      );
      assert.deepEqual(
        Object.keys(organizationOp.meta.base.attributes),
        Object.keys(organizationOp.attributes),
        'a base for every attribute the update sends, under the same key',
      );
      assert.strictEqual(organizationOp.attributes['legal-name'], 'Stad Test');
      assert.strictEqual(
        contactOp.meta.base.attributes.telephone,
        'tel:+3290000000',
        'the base goes through the transform of the attribute, as the proposal does',
      );
      assert.strictEqual(contactOp.attributes.telephone, 'tel:+3291111111');
      assert.strictEqual(contactOp.meta.base.attributes.type, 'Primary');
    });

    test('the base of a changed telephone number is the form the backend sent, also when that lacks "tel:"', async function (assert) {
      const load = (id, telephone) =>
        loadRecord(this.store, this.adapter, 'contact-point', {
          data: {
            type: 'contact-points',
            id,
            attributes: { telephone, type: 'Primary' },
          },
        });
      const prefixed = await load('contact-1', 'tel:+3290000000');
      const bare = await load('contact-2', '1770');
      const empty = await load('contact-3', '');
      assert.strictEqual(bare.telephone, '1770', 'shown as it is stored');
      prefixed.telephone = '+3291111111';
      bare.telephone = '+3227001770';
      empty.telephone = '+3227001771';
      acceptRequests(this.fetch, {});
      acceptReloads(this.adapter);

      await this.service.submit('site', 'org-1', [prefixed, bare, empty]);

      const telephones = postedOperations(this.fetch).map(({ data }) => [
        data.attributes.telephone,
        data.meta.base.attributes.telephone,
      ]);
      assert.deepEqual(
        telephones,
        [
          ['tel:+3291111111', 'tel:+3290000000'],
          ['tel:+3227001770', '1770'],
          ['tel:+3227001771', ''],
        ],
        'the proposal goes through the transform, the base is the value the service holds, which it compares exactly',
      );
    });

    test('an unchanged telephone number stored without "tel:" or as "" has its proposal as its base, so it is not written', async function (assert) {
      const load = (id, telephone) =>
        loadRecord(this.store, this.adapter, 'contact-point', {
          data: {
            type: 'contact-points',
            id,
            attributes: { telephone, email: 'info@gent.be', type: 'Primary' },
          },
        });
      const bare = await load('contact-1', '1770');
      const empty = await load('contact-2', '');
      bare.email = 'post@gent.be';
      empty.email = 'post@gent.be';
      // The pages write an empty field as null
      setEmptyStringsToNull(empty);
      acceptRequests(this.fetch, {});
      acceptReloads(this.adapter);

      await this.service.submit('site', 'org-1', [bare, empty]);

      const [bareOp, emptyOp] = postedOperations(this.fetch).map(
        ({ data }) => data,
      );
      assert.strictEqual(bareOp.attributes.telephone, 'tel:1770');
      assert.strictEqual(
        bareOp.meta.base.attributes.telephone,
        'tel:1770',
        'base and proposal agree, so the service does not write the number',
      );
      assert.strictEqual(bareOp.meta.base.attributes.email, 'info@gent.be');
      assert.strictEqual(emptyOp.attributes.telephone, null);
      assert.strictEqual(
        emptyOp.meta.base.attributes.telephone,
        null,
        'an empty number the page wrote as null is no change either',
      );
    });

    test('the base of a relationship is its remote state', async function (assert) {
      const { organization, otherSite } = loadOrganization(this.store);
      organization.primarySite = otherSite;
      (await organization.sites).push(otherSite);
      organization.legalForm = null;
      acceptRequests(this.fetch, {});
      acceptReloads(this.adapter);

      await this.service.submit('organization-core-data', 'org-1', [
        organization,
      ]);

      const [{ data }] = postedOperations(this.fetch);
      const base = data.meta.base.relationships;
      assert.deepEqual(data.relationships['primary-site'].data, {
        type: 'sites',
        id: 'site-2',
      });
      assert.deepEqual(
        base['primary-site'].data,
        { type: 'sites', id: 'site-1' },
        'a changed to-one: the record it pointed at',
      );
      assert.deepEqual(data.relationships.sites.data, [
        { type: 'sites', id: 'site-1' },
        { type: 'sites', id: 'site-2' },
      ]);
      assert.deepEqual(
        base.sites.data,
        [{ type: 'sites', id: 'site-1' }],
        'a changed to-many: the records it held',
      );
      assert.strictEqual(data.relationships['legal-form'].data, null);
      assert.deepEqual(
        base['legal-form'].data,
        { type: 'concepts', id: 'legal-form-1' },
        'a cleared to-one: the record it pointed at',
      );
      assert.deepEqual(
        base['organization-status'],
        data.relationships['organization-status'],
        'an unchanged relationship: its current value',
      );
      assert.deepEqual(
        Object.keys(base).sort(),
        Object.keys(data.relationships).sort(),
        'a base for every relationship the update sends',
      );
    });

    test('the base of a to-one that pointed at nothing is null, also when the page links a new record by lid', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      organization.primarySite = site;
      acceptRequests(this.fetch, {});
      acceptReloads(this.adapter);

      await this.service.submit('site', 'org-1', [
        contact,
        secondaryContact,
        address,
        site,
        organization,
      ]);

      const organizationOp = postedOperations(this.fetch).at(-1).data;
      assert.deepEqual(
        Object.keys(organizationOp.relationships['primary-site'].data),
        ['type', 'lid'],
      );
      assert.deepEqual(organizationOp.meta.base.relationships, {
        'primary-site': { data: null },
        sites: { data: [] },
      });
    });

    test('creates and deletes carry no base', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      (await organization.sites).push(site);
      const [oldContact] = this.store.push({
        data: [
          {
            type: 'contact-point',
            id: 'contact-old',
            attributes: { email: 'oud@gent.be', type: 'Secondary' },
          },
        ],
      });
      oldContact.deleteRecord();
      acceptRequests(this.fetch, {});
      acceptReloads(this.adapter);

      await this.service.submit('site', 'org-1', [
        contact,
        secondaryContact,
        address,
        site,
        oldContact,
        organization,
      ]);

      const operations = postedOperations(this.fetch);
      assert.deepEqual(
        operations.map(({ op, data }) => [op, Boolean(data.meta)]),
        [
          ['create', false],
          ['create', false],
          ['create', false],
          ['create', false],
          ['delete', false],
          ['update', true],
        ],
        'only the update carries meta.base',
      );
    });
  });

  module('held requests', function () {
    const CONFLICTS = [
      {
        resource: { type: 'organizations', id: 'org-1' },
        key: 'sites',
        base: [],
        current: [{ type: 'sites', id: 'site-9' }],
        proposed: [
          { type: 'sites', id: 'b3c5e9d2-1f4a-4c1e-9a77-0d2b8e6f4a10' },
        ],
        'competing-requests': [],
      },
    ];

    function holdRequests(fetchStub, conflicts) {
      fetchStub.resolves(
        jsonResponse(201, {
          data: {
            type: 'change-requests',
            id: REQUEST_ID,
            attributes: { status: 'ingediend', aggregate: 'site', conflicts },
          },
        }),
      );
    }

    test('it discards the local changes, unloads the new records and reloads the others when the service holds the request', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      (await organization.sites).push(site);
      organization.name = 'Stad Gent';
      holdRequests(this.fetch, CONFLICTS);
      // The backend answers with the current state: someone else added a site
      sinon
        .stub(this.adapter, 'findRecord')
        .callsFake((store, schema, id, snapshot) => {
          assert.step(
            `reload ${schema.modelName} ${id} include=${snapshot.include}`,
          );
          return Promise.resolve({
            data: {
              type: 'organizations',
              id,
              attributes: { name: 'Gemeente Test' },
              relationships: {
                sites: { data: [{ type: 'sites', id: 'site-9' }] },
              },
            },
            included: [{ type: 'sites', id: 'site-9', attributes: {} }],
          });
        });

      let error;
      try {
        await this.service.submit('site', 'org-1', [
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
      assert.true(error.held);
      assert.true(error.waiting, 'the request waits for ABB');
      assert.false(error.applied);
      assert.false(error.outcomeUnknown);
      assert.false(error.applyFailed);
      assert.false(error.reloadFailed);
      assert.strictEqual(error.status, 201);
      assert.strictEqual(
        error.requestId,
        REQUEST_ID,
        'the id of the held request, to withdraw it',
      );
      assert.deepEqual(error.conflicts, CONFLICTS);
      assert.true(error.message.includes('wacht op een beslissing van ABB'));
      assert.verifySteps(
        ['reload organization org-1 include=sites'],
        'only the organisation exists on the server; it is reloaded with the relationship the request changed',
      );
      for (const record of [site, address, contact, secondaryContact]) {
        assert.true(
          record.isDestroying,
          `the new ${record.constructor.modelName} is unloaded: it exists in the request only`,
        );
      }
      assert.false(organization.hasDirtyAttributes);
      assert.strictEqual(organization.name, 'Gemeente Test');
      assert.deepEqual(
        organization.hasMany('sites').ids(),
        ['site-9'],
        'the page sees the current sites',
      );
    });

    test('a held request is reported as held when the records cannot be reloaded', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        newSiteForOrganization(this.store);
      (await organization.sites).push(site);
      holdRequests(this.fetch, CONFLICTS);
      const reloadError = new Error('502 Bad Gateway');
      sinon.stub(this.adapter, 'findRecord').rejects(reloadError);
      const logged = sinon.stub(console, 'error');

      let error;
      try {
        await this.service.submit('site', 'org-1', [
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
      assert.true(error.held, 'nothing is applied, the request waits');
      assert.false(error.applied);
      assert.true(
        error.reloadFailed,
        'the page holds the loaded values, not the current ones',
      );
      assert.strictEqual(error.cause, reloadError);
      assert.true(
        logged.calledWith(sinon.match.string, reloadError),
        'the reason is logged',
      );
      assert.strictEqual(error.requestId, REQUEST_ID);
      assert.true(site.isDestroying);
      assert.deepEqual(
        organization.hasMany('sites').ids(),
        [],
        'the local changes are discarded all the same',
      );
    });

    test('a request held without conflicts is held all the same', async function (assert) {
      const organization = this.store.push({
        data: {
          type: 'organization',
          id: 'org-1',
          attributes: { name: 'Gemeente Test' },
        },
      });
      organization.name = 'Stad Test';
      holdRequests(this.fetch, undefined);
      acceptReloads(this.adapter);

      let error;
      try {
        await this.service.submit('organization-core-data', 'org-1', [
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error.held);
      assert.deepEqual(error.conflicts, []);
      assert.false(organization.hasDirtyAttributes);
    });

    test('a stale edit the service refuses (409 with the conflicts) is held without a request: the records are reloaded, nothing waits for ABB', async function (assert) {
      const organization = this.store.push({
        data: {
          type: 'organization',
          id: 'org-1',
          attributes: { name: 'Gemeente Test' },
        },
      });
      organization.name = 'Stad Test';
      const conflicts = [
        {
          resource: { type: 'organizations', id: 'org-1' },
          key: 'name',
          base: 'Gemeente Test',
          current: 'Gemeente Test (ABB)',
          proposed: 'Stad Test',
          'competing-requests': [],
        },
      ];
      this.fetch.resolves(
        jsonResponse(409, {
          errors: [
            {
              status: '409',
              title:
                'The change conflicts with changes made since the form was loaded',
              detail:
                '1 conflict with what changed since the form was loaded; nothing was saved. Reload the form and save the change again',
              meta: { conflicts, 'conflicts-token': '5ac5a8f6', competing: [] },
            },
          ],
        }),
      );
      sinon.stub(this.adapter, 'findRecord').resolves({
        data: {
          type: 'organizations',
          id: 'org-1',
          attributes: { name: 'Gemeente Test (ABB)' },
        },
      });

      let error;
      try {
        await this.service.submit('organization-core-data', 'org-1', [
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error instanceof ChangeRequestError);
      assert.true(
        error.held,
        'nothing is applied and the records are reloaded',
      );
      assert.false(error.waiting, 'no request waits for ABB');
      assert.strictEqual(error.requestId, null, 'nothing was recorded');
      assert.strictEqual(error.status, 409);
      assert.deepEqual(error.conflicts, conflicts);
      assert.false(error.applyFailed);
      assert.false(error.reloadFailed);
      assert.false(error.message.includes('ABB'));
      assert.true(error.message.includes('(name)'));
      assert.false(organization.hasDirtyAttributes);
      assert.strictEqual(
        organization.name,
        'Gemeente Test (ABB)',
        'the page sees the current name',
      );
    });
  });

  module('failed applies', function () {
    test('a 409 for an apply that failed carries the id of the kept request and a message for the user, and keeps the edits', async function (assert) {
      const organization = this.store.push({
        data: {
          type: 'organization',
          id: 'org-1',
          attributes: { name: 'Gemeente Test' },
        },
      });
      organization.name = 'Stad Test';
      this.fetch.resolves(
        jsonResponse(409, {
          errors: [
            {
              status: '409',
              title: 'Applying the change request failed',
              detail: `Virtuoso 42000 Error. The request is kept with status mislukt; a hertoepassing (POST /change-requests/${REQUEST_ID}/steps) applies its stored versions again.`,
              meta: { 'change-request': { id: REQUEST_ID, status: 'mislukt' } },
            },
          ],
        }),
      );

      let error;
      try {
        await this.service.submit('organization-core-data', 'org-1', [
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.true(error instanceof ChangeRequestError);
      assert.true(error.applyFailed);
      assert.strictEqual(error.requestId, REQUEST_ID);
      assert.strictEqual(error.status, 409);
      assert.false(error.held);
      assert.false(error.applied);
      assert.false(error.outcomeUnknown);
      assert.true(
        error.message.startsWith(
          'De wijziging kon niet doorgevoerd worden: het toepassen ervan mislukte.',
        ),
        'a message in Dutch instead of the detail of the service',
      );
      assert.true(organization.hasDirtyAttributes, 'the edits are kept');
      assert.strictEqual(organization.name, 'Stad Test');
    });

    test('another 409 is a refusal without a request to apply again', async function (assert) {
      const organization = this.store.push({
        data: {
          type: 'organization',
          id: 'org-1',
          attributes: { name: 'Gemeente Test' },
        },
      });
      organization.name = 'Stad Test';
      this.fetch.resolves(
        jsonResponse(409, {
          errors: [{ status: '409', title: 'Conflict', detail: 'Bezet.' }],
        }),
      );

      let error;
      try {
        await this.service.submit('organization-core-data', 'org-1', [
          organization,
        ]);
      } catch (e) {
        error = e;
      }

      assert.false(error.applyFailed);
      assert.strictEqual(error.requestId, null);
      assert.strictEqual(error.message, 'Bezet.');
    });
  });

  module('steps', function () {
    function stepOf(fetchStub) {
      const [url, options] = fetchStub.lastCall.args;
      return { url, options, document: JSON.parse(options.body) };
    }

    function stepError(status, meta) {
      return jsonResponse(status, {
        errors: [
          {
            status: String(status),
            title: 'The change request cannot take this step',
            meta,
          },
        ],
      });
    }

    test('withdraw takes an intrekking step on the request', async function (assert) {
      this.fetch.resolves(
        jsonResponse(201, {
          data: {
            type: 'change-requests',
            id: REQUEST_ID,
            attributes: { status: 'ingetrokken' },
          },
        }),
      );

      await this.service.withdraw(REQUEST_ID);

      const { url, options, document } = stepOf(this.fetch);
      assert.strictEqual(url, `/change-requests/${REQUEST_ID}/steps`);
      assert.strictEqual(options.method, 'POST');
      assert.strictEqual(
        options.headers['Content-Type'],
        'application/vnd.api+json',
      );
      assert.deepEqual(document, {
        data: {
          type: 'change-request-steps',
          attributes: { 'step-type': 'intrekking' },
        },
      });
    });

    test('withdraw accepts a request that is withdrawn already and says why it cannot withdraw one ABB decided on', async function (assert) {
      this.fetch.resolves(
        stepError(409, { status: 'ingetrokken', 'step-type': 'intrekking' }),
      );
      assert.strictEqual(
        await this.service.withdraw(REQUEST_ID),
        undefined,
        'withdrawn already: resolves',
      );

      this.fetch.resolves(
        stepError(409, { status: 'afgehandeld', 'step-type': 'intrekking' }),
      );
      let error = await rejection(this.service.withdraw(REQUEST_ID));
      assert.true(error instanceof ChangeRequestError);
      assert.strictEqual(
        error.message,
        'ABB heeft je aanvraag intussen goedgekeurd; ze kan niet meer ingetrokken worden.',
      );

      this.fetch.resolves(stepError(403, { rule: null, rules: [] }));
      error = await rejection(this.service.withdraw(REQUEST_ID));
      assert.strictEqual(error.message, 'Je mag deze aanvraag niet intrekken.');

      this.fetch.rejects(new TypeError('Failed to fetch'));
      error = await rejection(this.service.withdraw(REQUEST_ID));
      assert.true(error instanceof ChangeRequestError);
      assert.true(error.message.startsWith('De intrekking kon niet verstuurd'));
    });

    test('reapply takes a hertoepassing step on the request', async function (assert) {
      this.fetch.resolves(
        jsonResponse(201, {
          data: {
            type: 'change-requests',
            id: REQUEST_ID,
            attributes: { status: 'afgehandeld' },
          },
        }),
      );

      await this.service.reapply(REQUEST_ID);

      const { url, document } = stepOf(this.fetch);
      assert.strictEqual(url, `/change-requests/${REQUEST_ID}/steps`);
      assert.deepEqual(document.data.attributes, {
        'step-type': 'hertoepassing',
      });
    });

    test('reapply tells a request that failed again or did not get through from one the service refuses', async function (assert) {
      this.fetch.resolves(
        stepError(409, {
          'change-request': { id: REQUEST_ID, status: 'mislukt' },
        }),
      );
      let error = await rejection(this.service.reapply(REQUEST_ID));
      assert.true(error.applyFailed, 'failed once more: it can be tried again');
      assert.false(error.refused);
      assert.strictEqual(error.requestId, REQUEST_ID);

      this.fetch.resolves(new Response('Bad Gateway', { status: 502 }));
      error = await rejection(this.service.reapply(REQUEST_ID));
      assert.true(error.outcomeUnknown, 'a 5xx: it can be tried again');
      assert.false(error.refused);

      this.fetch.resolves(
        stepError(409, { status: 'afgehandeld', 'step-type': 'hertoepassing' }),
      );
      assert.strictEqual(
        await this.service.reapply(REQUEST_ID),
        undefined,
        'applied meanwhile, e.g. from another tab: resolves',
      );

      this.fetch.resolves(
        stepError(409, {
          'change-request': {
            id: '47b4a8ba-1229-409e-a326-ac4250defec4',
            status: 'afgehandeld',
          },
        }),
      );
      error = await rejection(this.service.reapply(REQUEST_ID));
      assert.true(error.refused, 'refused: the page must be reloaded');
      assert.false(error.applyFailed);
      assert.false(error.outcomeUnknown);
      assert.strictEqual(
        error.message,
        'Intussen werd een andere wijziging van deze organisatie doorgevoerd, daarom wordt je aanvraag niet meer toegepast. Herlaad de pagina en voer je wijziging opnieuw in.',
      );
    });
  });

  module('a creation', function () {
    test('a request without target carries no target relationship and keeps the reason', async function (assert) {
      const organization = this.store.createRecord('administrative-unit', {
        legalName: 'AGB Test',
      });
      this.fetch.resolves(
        jsonResponse(201, {
          data: {
            type: 'change-requests',
            id: REQUEST_ID,
            attributes: { status: 'ingediend', aggregate: 'new-organisation' },
          },
        }),
      );

      const error = await rejection(
        this.service.submit('new-organisation', null, [organization], {
          reason: 'Opgericht bij besluit',
        }),
      );

      const document = JSON.parse(this.fetch.lastCall.args[1].body);
      assert.strictEqual(document.data.relationships, undefined, 'no target');
      assert.strictEqual(
        document.data.attributes.aggregate,
        'new-organisation',
      );
      assert.strictEqual(
        document.data.attributes.reason,
        'Opgericht bij besluit',
      );
      assert.strictEqual(document.data.attributes.operations[0].op, 'create');
      assert.true(error.held);
      assert.true(error.waiting, 'it waits for ABB');
      assert.strictEqual(error.requestId, REQUEST_ID);
      assert.true(
        organization.isDestroying,
        'the new record exists in the request only',
      );
    });
  });

  module('listing and deciding', function () {
    const DOCUMENT = {
      type: 'change-requests',
      id: REQUEST_ID,
      attributes: { status: 'ingediend', kind: 'creation', steps: [] },
      relationships: {
        target: {
          data: { type: 'organizations', id: 'org-new' },
          meta: { pending: true },
        },
        'requesting-organisation': {
          data: { type: 'organizations', id: 'org-1' },
        },
      },
    };

    function errorResponse(status, error) {
      return jsonResponse(status, {
        errors: [{ status: String(status), title: 'Refused', ...error }],
      });
    }

    test('list asks one page with the filters as the service names them and returns the documents with the total', async function (assert) {
      this.fetch.resolves(
        jsonResponse(200, {
          data: [DOCUMENT],
          meta: { count: 7 },
          links: { first: '/change-requests?page[number]=0' },
        }),
      );

      const result = await this.service.list({
        kind: 'creation',
        mine: true,
        requester: 'org-1',
        target: 'org-new',
        targetClassification: 'cls-1',
        status: 'ingediend,informatie-gevraagd',
        createdFrom: '2026-10-01T00:00:00.000Z',
        createdUntil: '2026-10-31T23:59:59.999Z',
        sort: '-created',
        page: 2,
        size: 10,
      });

      const [url, options] = this.fetch.lastCall.args;
      const query = new URL(url, 'http://test').searchParams;
      assert.deepEqual(Object.fromEntries(query), {
        'filter[kind]': 'creation',
        'filter[mine]': 'true',
        'filter[requester]': 'org-1',
        'filter[target]': 'org-new',
        'filter[target-classification]': 'cls-1',
        'filter[status]': 'ingediend,informatie-gevraagd',
        'filter[created][gte]': '2026-10-01T00:00:00.000Z',
        'filter[created][lte]': '2026-10-31T23:59:59.999Z',
        sort: '-created',
        'page[number]': '2',
        'page[size]': '10',
      });
      assert.true(url.startsWith('/change-requests?'));
      assert.strictEqual(options.headers.Accept, 'application/vnd.api+json');
      assert.deepEqual(result, {
        requests: [DOCUMENT],
        count: 7,
        links: { first: '/change-requests?page[number]=0' },
      });
    });

    test('list without filters asks the first page of everything; a refused listing is an error with a message', async function (assert) {
      this.fetch.resolves(jsonResponse(200, { data: [], meta: { count: 0 } }));

      const result = await this.service.list();

      const [url] = this.fetch.lastCall.args;
      assert.deepEqual(
        Object.fromEntries(new URL(url, 'http://test').searchParams),
        { 'page[number]': '0', 'page[size]': '20' },
      );
      assert.deepEqual(result, { requests: [], count: 0, links: {} });

      this.fetch.resolves(
        errorResponse(400, { detail: 'filter[kind]: unknown value "foo"' }),
      );
      let error = await rejection(this.service.list({ kind: 'foo' }));
      assert.true(error instanceof ChangeRequestError);
      assert.strictEqual(error.status, 400);
      assert.strictEqual(
        error.message,
        'De filters zijn ongeldig. Herstel de filters en probeer opnieuw.',
      );

      this.fetch.rejects(new TypeError('Failed to fetch'));
      error = await rejection(this.service.list());
      assert.true(
        error.message.startsWith('De aanvragen konden niet opgehaald'),
      );
    });

    test('find returns the document of a request and says when it is not found', async function (assert) {
      this.fetch.resolves(jsonResponse(200, { data: DOCUMENT }));

      const document = await this.service.find(REQUEST_ID);

      assert.strictEqual(
        this.fetch.lastCall.args[0],
        `/change-requests/${REQUEST_ID}`,
      );
      assert.deepEqual(document, DOCUMENT);

      this.fetch.resolves(errorResponse(404, { detail: 'No such request' }));
      const error = await rejection(this.service.find(REQUEST_ID));
      assert.strictEqual(error.status, 404);
      assert.strictEqual(error.message, 'De aanvraag werd niet gevonden.');
    });

    test('takeDecision posts the step with its text and override and returns the updated request', async function (assert) {
      const updated = {
        ...DOCUMENT,
        attributes: { ...DOCUMENT.attributes, status: 'afgekeurd' },
      };
      // A fresh Response per call: a body can be read once
      this.fetch.callsFake(async () => jsonResponse(201, { data: updated }));

      const document = await this.service.takeDecision(
        REQUEST_ID,
        'afkeuring',
        {
          reason: 'Het KBO-nummer klopt niet',
        },
      );

      const [url, options] = this.fetch.lastCall.args;
      assert.strictEqual(url, `/change-requests/${REQUEST_ID}/steps`);
      assert.strictEqual(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        data: {
          type: 'change-request-steps',
          attributes: {
            'step-type': 'afkeuring',
            reason: 'Het KBO-nummer klopt niet',
          },
        },
      });
      assert.deepEqual(document, updated);

      await this.service.takeDecision(REQUEST_ID, 'goedkeuring', {
        override: '5ac5a8f6',
      });
      assert.deepEqual(
        JSON.parse(this.fetch.lastCall.args[1].body).data.attributes,
        {
          'step-type': 'goedkeuring',
          override: '5ac5a8f6',
        },
      );
    });

    test('takeDecision explains a refused step: no longer admitted, not allowed, or changed data with the conflicts to review', async function (assert) {
      this.fetch.resolves(
        errorResponse(409, {
          detail: 'The status afgekeurd does not admit goedkeuring',
          meta: { status: 'afgekeurd', 'step-type': 'goedkeuring' },
        }),
      );
      let error = await rejection(
        this.service.takeDecision(REQUEST_ID, 'goedkeuring'),
      );
      assert.true(error instanceof ChangeRequestError);
      assert.strictEqual(
        error.message,
        'Deze stap is niet meer mogelijk: de aanvraag is intussen afgekeurd.',
      );
      assert.deepEqual(error.conflicts, []);

      this.fetch.resolves(
        errorResponse(403, { meta: { rule: null, rules: [] } }),
      );
      error = await rejection(
        this.service.takeDecision(REQUEST_ID, 'afkeuring', { reason: 'x' }),
      );
      assert.strictEqual(error.message, 'Je mag deze stap niet zetten.');

      const conflicts = [
        {
          resource: { type: 'administrative-units', id: 'org-1' },
          key: 'name',
          base: 'Aalst',
          current: 'Aalst (ABB)',
          proposed: 'Stad Aalst',
          'competing-requests': [],
        },
      ];
      this.fetch.resolves(
        errorResponse(409, {
          detail: '1 conflict; approve with "override"',
          meta: { conflicts, 'conflicts-token': '5ac5a8f6' },
        }),
      );
      error = await rejection(
        this.service.takeDecision(REQUEST_ID, 'goedkeuring'),
      );
      assert.strictEqual(error.status, 409);
      assert.deepEqual(error.conflicts, conflicts, 'the conflicts to review');
      assert.strictEqual(
        error.conflictsToken,
        '5ac5a8f6',
        'the token that overrides exactly them',
      );
      assert.true(error.message.includes('intussen gewijzigd'));

      this.fetch.resolves(
        errorResponse(422, { detail: 'an afkeuring needs a reason' }),
      );
      error = await rejection(
        this.service.takeDecision(REQUEST_ID, 'afkeuring'),
      );
      assert.strictEqual(
        error.message,
        'an afkeuring needs a reason',
        'the detail of the service',
      );
    });

    test('loadRights keeps what the session may do with requests, and nothing when the service does not answer', async function (assert) {
      this.fetch.resolves(
        jsonResponse(200, {
          'can-create': ['http://example.org/classification/agb'],
          'can-decide': false,
        }),
      );

      const rights = await this.service.loadRights();

      assert.strictEqual(
        this.fetch.lastCall.args[0],
        '/change-requests/permissions',
      );
      assert.deepEqual(rights, {
        canDecide: false,
        canCreate: ['http://example.org/classification/agb'],
      });
      assert.deepEqual(this.service.rights, rights, 'kept for the pages');

      this.fetch.resolves(new Response('Bad Gateway', { status: 502 }));
      sinon.stub(console, 'warn');
      assert.deepEqual(await this.service.loadRights(), {
        canDecide: false,
        canCreate: [],
      });
      assert.deepEqual(this.service.rights, {
        canDecide: false,
        canCreate: [],
      });
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
