import { module, test } from 'qunit';
import sinon from 'sinon';
import { click, currentURL, fillIn, visit } from '@ember/test-helpers';
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
  [CHANGE_EVENT_TYPE.WERKINGSGEBIED_CHANGE]: 'Wijziging werkingsgebied',
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
        case 'organization-status-code':
          return {
            data: {
              type: 'organization-status-codes',
              id,
              attributes: { label: 'Actief' },
            },
          };
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
    assert
      .dom('form')
      .includesText('Huidige naam AGB Aalst', 'next to the current name');
  });

  test('a werkingsgebied change shows the current werkingsgebied', async function (assert) {
    await visit('/organisaties/org-agb/veranderingsgebeurtenissen/nieuw');

    await click('#change-event-type');
    await click(
      [...document.querySelectorAll('.ember-power-select-option')].find(
        (option) => option.textContent.includes('Wijziging werkingsgebied'),
      ),
    );

    assert.dom('#change-event-scope').exists('the new werkingsgebied is asked');
    assert
      .dom('form')
      .includesText(
        'Huidig werkingsgebied Aalst',
        'the label the scope-of-operation service gives the current one',
      );
    assert.true(
      this.fetch
        .getCalls()
        .some(({ args: [url] }) =>
          String(url).includes('/scope-of-operation/locations-in-scope/'),
        ),
      'the locations of the current werkingsgebied are asked to prefill the new one',
    );
  });

  /**
   * Opens the change-event form of an oprichting and fills in what the
   * request requires before the besluit.
   */
  async function fillOprichting(owner) {
    await visit('/organisaties/org-agb/veranderingsgebeurtenissen/nieuw');
    await click('#change-event-type');
    await click(
      [...document.querySelectorAll('.ember-power-select-option')].find(
        (option) => option.textContent.includes('Oprichting'),
      ),
    );
    const controller = owner.lookup(
      'controller:organizations/organization/change-events/new',
    );
    controller.model.changeEvent.date = new Date(2026, 9, 1);
  }

  /**
   * The besluit the page hands to the change-request service on submit.
   */
  async function submitDecision(assert, context) {
    const service = context.owner.lookup('service:change-requests');
    const submit = sinon.stub(service, 'submit').resolves({
      get: () => ({ id: 'new-org' }),
    });
    sinon.stub(context.owner.lookup('service:router'), 'replaceWith');
    await click('[data-test-submit-request]');
    assert.true(submit.calledOnce, 'the request is sent');
    const records = submit.firstCall.args[2];
    const decisions = records.filter(
      (record) => record.constructor.modelName === 'decision',
    );
    assert.strictEqual(decisions.length, 1, 'one besluit in the request');
    return decisions[0];
  }

  test('the besluit asks whether a link is available, with three options', async function (assert) {
    await fillOprichting(this.owner);

    assert
      .dom('#decision-links-yes-links')
      .exists('one or more links is an option');
    assert
      .dom('#decision-links-yes-text')
      .exists('a text instead of the link is an option');
    assert
      .dom('#decision-links-no')
      .exists('no link is available is an option');
    assert.strictEqual(
      document
        .querySelector('#decision-links-no')
        ?.closest('label')
        ?.textContent.trim(),
      'Nee, ik heb geen link naar een besluit',
      'its label',
    );

    const linksField = () =>
      document
        .querySelector('input[name="decision-links-choice"]')
        ?.closest('.au-c-control-group')?.parentElement.textContent;

    await click('#decision-links-yes-links');
    assert.true(
      linksField().includes('Nog geen links toegevoegd'),
      'an empty choice shows the empty state',
    );
    await click(
      [...document.querySelectorAll('button')].find((button) =>
        button.textContent.includes('Nieuwe link toevoegen'),
      ),
    );
    await fillIn('#change-event-decision-link-0', 'https://aalst.be/besluiten');
    assert.dom('#change-event-decision-link-0').exists('the link row is added');
    assert.false(
      linksField().includes('Nog geen links toegevoegd'),
      'the empty state is gone once a row exists',
    );

    await click('#decision-links-yes-text');
    assert.dom('#decision-links-text-input').exists('the text is asked');
    assert.dom('#decision-links-none-input').doesNotExist();
    assert
      .dom('#change-event-decision-link-0')
      .doesNotExist('the link row is gone');
  });

  test('a besluit with a text only is saved without links', async function (assert) {
    await fillOprichting(this.owner);

    await click('#decision-links-yes-text');
    await fillIn(
      '#decision-links-text-input',
      'Besluit van de gemeenteraad van 1 oktober 2026',
    );
    const decision = await submitDecision(assert, this);

    assert.strictEqual(
      decision.description,
      'Besluit van de gemeenteraad van 1 oktober 2026',
    );
    assert.deepEqual(decision.documentLinks, [], 'no links are saved');
    assert.notOk(decision.geenLinkBeschikbaar, 'no no-link message');
  });

  test('a besluit that says no link is available is saved with its message', async function (assert) {
    await fillOprichting(this.owner);

    await click('#decision-links-no');
    await fillIn(
      '#decision-links-none-input',
      'Het besluit is niet online beschikbaar.',
    );
    const decision = await submitDecision(assert, this);

    assert.strictEqual(
      decision.geenLinkBeschikbaar,
      'Het besluit is niet online beschikbaar.',
    );
    assert.deepEqual(decision.documentLinks, [], 'no links are saved');
    assert.notOk(decision.description, 'no text');
  });
});
