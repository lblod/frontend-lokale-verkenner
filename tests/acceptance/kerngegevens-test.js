import { module, test } from 'qunit';
import sinon from 'sinon';
import {
  blur,
  click,
  fillIn,
  triggerEvent,
  visit,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { ID_NAME } from 'frontend-organization-portal/models/identifier';

/**
 * The uuid of a change request the service kept.
 */
const REQUEST_ID = '150953dd-7844-4a8a-bfcb-b4f479521474';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

/**
 * An AGB as the kerngegevens route loads it: its juridische vorm and
 * werkingsgebied come as links, its qualifications, theme and KBO number are
 * included (a save of an AGB needs the last two).
 */
const AGB = {
  type: 'administrative-units',
  id: 'org-agb',
  attributes: { name: 'AGB Aalst', 'legal-name': 'AGB Aalst' },
  relationships: {
    classification: {
      data: {
        type: 'administrative-unit-classification-codes',
        id: CLASSIFICATION.AGB.id,
      },
    },
    'organization-status': {
      data: { type: 'organization-status-codes', id: 'status-1' },
    },
    'legal-form': {
      links: { related: '/administrative-units/org-agb/legal-form' },
    },
    scope: { links: { related: '/administrative-units/org-agb/scope' } },
    'additional-qualifications': {
      data: [{ type: 'additional-qualification-codes', id: 'qualification-1' }],
    },
    identifiers: { data: [{ type: 'identifiers', id: 'identifier-kbo' }] },
    'primary-site': { data: null },
    'content-themes': { data: [{ type: 'concepts', id: 'theme-1' }] },
    vendors: { data: [] },
  },
};

const INCLUDED = [
  {
    type: 'administrative-unit-classification-codes',
    id: CLASSIFICATION.AGB.id,
    attributes: { label: 'Autonoom gemeentebedrijf' },
  },
  {
    type: 'organization-status-codes',
    id: 'status-1',
    attributes: { label: 'Actief' },
  },
  {
    type: 'additional-qualification-codes',
    id: 'qualification-1',
    attributes: { label: 'Afvalintercommunale', 'legal-basis': 'Decreet' },
  },
  {
    type: 'concepts',
    id: 'theme-1',
    attributes: { label: 'Afval' },
  },
  {
    type: 'identifiers',
    id: 'identifier-kbo',
    attributes: { 'id-name': ID_NAME.KBO },
    relationships: {
      'structured-identifier': {
        data: { type: 'structured-identifiers', id: 'structured-kbo' },
      },
    },
  },
  {
    type: 'structured-identifiers',
    id: 'structured-kbo',
    attributes: { 'local-id': '0123456789' },
  },
];

module('Acceptance | kerngegevens bewerken', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    const adapter = this.owner.lookup('adapter:application');
    sinon.stub(adapter, 'findRecord').callsFake(async (store, schema, id) => {
      if (schema.modelName === 'account') {
        return {
          data: {
            type: 'accounts',
            id,
            attributes: { roles: ['ABBOrganisatiePortaalGebruiker-beheerder'] },
            relationships: { user: { data: { type: 'users', id: 'user-1' } } },
          },
          included: [
            {
              type: 'users',
              id: 'user-1',
              attributes: { 'first-name': 'Test', 'family-name': 'AGB' },
            },
          ],
        };
      }
      // A copy: the serializer normalises a document in place
      return structuredClone({ data: AGB, included: INCLUDED });
    });
    sinon.stub(adapter, 'query').resolves({ data: [] });
    sinon
      .stub(adapter, 'findBelongsTo')
      .callsFake(async (store, snapshot, url) =>
        url.endsWith('/scope')
          ? {
              data: {
                type: 'locations',
                id: 'location-1',
                attributes: { label: 'Aalst' },
              },
            }
          : {
              data: {
                type: 'concepts',
                id: 'legal-form-1',
                attributes: { label: 'Autonoom gemeentebedrijf (rechtsvorm)' },
              },
            },
      );
    this.fetch = sinon.stub(window, 'fetch').callsFake(async (url) => {
      const { pathname } = new URL(url, window.location.origin);
      if (pathname === '/change-requests/permissions') {
        return jsonResponse(200, {
          'can-edit': true,
          'can-decide': false,
          'can-create': [],
          rules: ['own-organisation'],
        });
      }
      if (pathname.startsWith('/scope-of-operation/label-for-scope/')) {
        return jsonResponse(200, 'Aalst en omgeving');
      }
      if (pathname.startsWith('/scope-of-operation/')) {
        return jsonResponse(200, []);
      }
      return jsonResponse(404, { errors: [{ status: '404' }] });
    });

    await authenticateSession({
      relationships: {
        account: { data: { type: 'accounts', id: 'account-1' } },
        group: { data: { type: 'groups', id: 'org-agb' } },
      },
    });
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('juridische vorm, werkingsgebied and qualifications are shown, with the way to change them: a veranderingsgebeurtenis', async function (assert) {
    await visit('/organisaties/org-agb/kerngegevens/edit');

    assert
      .dom('[data-test-read-only="legal-form"]')
      .includesText('Autonoom gemeentebedrijf (rechtsvorm)');
    assert
      .dom('[data-test-read-only="scope"]')
      .includesText('Aalst en omgeving');
    assert
      .dom('[data-test-read-only="additional-qualifications"]')
      .includesText('Afvalintercommunale');
    for (const field of ['legal-form', 'scope', 'additional-qualifications']) {
      assert
        .dom(`[data-test-read-only="${field}"] [data-test-change-event-link]`)
        .hasAttribute(
          'href',
          '/organisaties/org-agb/veranderingsgebeurtenissen/nieuw',
        );
    }
    assert.dom('#legal-form-select').doesNotExist();
    assert.dom('#locations-select').doesNotExist();
    assert.dom('#additional-qualifications-select').doesNotExist();
    assert.dom('#organization-legal-name').exists('the rest stays editable');
  });

  test('a save whose apply failed keeps saving blocked and links to the kept request', async function (assert) {
    // The service kept the request, but applying it failed twice
    this.fetch.withArgs('/change-requests').callsFake(async () =>
      jsonResponse(409, {
        errors: [
          {
            status: '409',
            title: 'Applying the change request failed',
            meta: { 'change-request': { id: REQUEST_ID, status: 'mislukt' } },
          },
        ],
      }),
    );
    const submits = () => this.fetch.withArgs('/change-requests').callCount;

    await visit('/organisaties/org-agb/kerngegevens/edit');
    await fillIn('#organization-legal-name', 'AGB Aalst Noord');
    await blur('#organization-legal-name');
    await click('button[form="edit-core-info-form"]');
    await waitFor('[data-test-failed-request]');

    assert.strictEqual(submits(), 1);
    assert
      .dom('[data-test-failed-request]')
      .hasAttribute('href', `/aanvragen/${REQUEST_ID}`);
    assert.dom('[data-test-failed-request]').hasText('Bekijk de aanvraag');
    assert.dom('button[form="edit-core-info-form"]').isDisabled();
    assert.dom('#organization-legal-name').hasValue('AGB Aalst Noord');

    await triggerEvent('#edit-core-info-form', 'submit');

    assert.strictEqual(submits(), 1, 'a second save sends nothing');
  });

  test('a KBO number another organisation holds is shown on the KBO field, in Dutch', async function (assert) {
    this.fetch.withArgs('/change-requests').callsFake(async () =>
      jsonResponse(409, {
        errors: [
          {
            status: '409',
            title: 'An organisation with this KBO number is already registered',
            meta: {
              'kbo-number': '0123456789',
              organisation: { type: 'organizations', id: 'org-other' },
            },
          },
        ],
      }),
    );

    await visit('/organisaties/org-agb/kerngegevens/edit');
    await fillIn('#organization-legal-name', 'AGB Aalst Noord');
    await blur('#organization-legal-name');
    await click('button[form="edit-core-info-form"]');
    const kboItem = document
      .querySelector('#kbo-identifier')
      .closest('.au-c-card-item');
    // The save task runs on after the click settles
    await waitUntil(() => kboItem.textContent.includes('KBO-nummer'), {
      timeoutMessage: 'the KBO field never showed the message of the 409',
    });

    assert
      .dom(kboItem)
      .includesText('Er bestaat al een organisatie met dit KBO-nummer.');
    assert.dom(kboItem).doesNotIncludeText('[object Object]');
    assert
      .dom('button[form="edit-core-info-form"]')
      .isNotDisabled('a corrected number can be sent');
  });
});
