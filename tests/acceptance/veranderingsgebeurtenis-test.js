import { module, test } from 'qunit';
import sinon from 'sinon';
import { click, currentURL, visit } from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { CHANGE_EVENT_TYPE } from 'frontend-organization-portal/models/change-event-type';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

/**
 * An AGB as the organisation route loads it, with its status and
 * classification; its juridische vorm and werkingsgebied come as links,
 * which the change-event route loads before the form opens.
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
    identifiers: { data: [] },
    'primary-site': { data: null },
    'content-themes': { data: [] },
    vendors: { data: [] },
  },
};

const QUALIFICATION = {
  type: 'additional-qualification-codes',
  id: 'qualification-1',
  attributes: { label: 'Afvalintercommunale', 'legal-basis': 'Decreet' },
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
  QUALIFICATION,
];

/**
 * The code list of the event types: what an AGB may record, a
 * multi-organisation event (fusie) and a worship-only one.
 */
const TYPES = {
  [CHANGE_EVENT_TYPE.NAME_CHANGE]: 'Naamswijziging',
  [CHANGE_EVENT_TYPE.OPRICHTING]: 'Oprichting',
  [CHANGE_EVENT_TYPE.FUSIE]: 'Fusie',
  [CHANGE_EVENT_TYPE.RECOGNITION_GRANTED]: 'Erkenning toegekend',
};

function typeResource(id) {
  return { type: 'change-event-types', id, attributes: { label: TYPES[id] } };
}

function optionTexts() {
  return [...document.querySelectorAll('.ember-power-select-option')].map(
    (option) => option.textContent.trim(),
  );
}

module('Acceptance | veranderingsgebeurtenis aanvragen', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    const adapter = this.owner.lookup('adapter:application');
    sinon.stub(adapter, 'findRecord').callsFake(async (store, schema, id) => {
      switch (schema.modelName) {
        case 'account':
          return {
            data: {
              type: 'accounts',
              id,
              attributes: {
                roles: ['ABBOrganisatiePortaalGebruiker-beheerder'],
              },
              relationships: {
                user: { data: { type: 'users', id: 'user-1' } },
              },
            },
            included: [
              {
                type: 'users',
                id: 'user-1',
                attributes: { 'first-name': 'Test', 'family-name': 'AGB' },
              },
            ],
          };
        case 'organization':
        case 'administrative-unit':
          // A copy: the serializer normalises a document in place
          return structuredClone({ data: AGB, included: INCLUDED });
        case 'additional-qualification-code':
          return { data: structuredClone(QUALIFICATION) };
        case 'change-event-type':
          return { data: typeResource(id) };
        default:
          return { data: null };
      }
    });
    sinon
      .stub(adapter, 'findMany')
      .resolves({ data: [structuredClone(QUALIFICATION)] });
    sinon.stub(adapter, 'query').resolves({ data: [] });
    sinon
      .stub(adapter, 'findAll')
      .callsFake(async (store, schema) =>
        schema.modelName === 'change-event-type'
          ? { data: Object.keys(TYPES).map(typeResource) }
          : { data: [] },
      );
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
      const { pathname, searchParams } = new URL(url, window.location.origin);
      if (pathname === '/change-requests/permissions') {
        return searchParams.has('target')
          ? jsonResponse(200, {
              'can-edit': true,
              'can-submit-change-event': true,
              'can-decide': false,
            })
          : jsonResponse(200, { 'can-decide': false, 'can-create': [] });
      }
      if (pathname.startsWith('/scope-of-operation/label-for-scope/')) {
        return jsonResponse(200, 'Aalst');
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

  test('the form offers the event types of an AGB, without the multi-organisation and worship-only ones, and a naamswijziging asks for the new name', async function (assert) {
    await visit('/organisaties/org-agb/veranderingsgebeurtenissen/nieuw');

    assert.strictEqual(
      currentURL(),
      '/organisaties/org-agb/veranderingsgebeurtenissen/nieuw',
      'opens for who may edit the organisation',
    );
    assert.dom('[data-test-submit-request]').exists();

    await click('#change-event-type');
    const options = optionTexts();
    assert.true(options.includes('Naamswijziging'), `offered: ${options}`);
    assert.true(options.includes('Oprichting'), `offered: ${options}`);
    assert.false(
      options.includes('Fusie'),
      'a fusie concerns several organisations',
    );
    assert.false(options.includes('Erkenning toegekend'), 'worship only');

    await click(
      [...document.querySelectorAll('.ember-power-select-option')].find(
        (option) => option.textContent.includes('Naamswijziging'),
      ),
    );
    assert.dom('#change-event-resulting-name').exists('the new name is asked');
  });
});
