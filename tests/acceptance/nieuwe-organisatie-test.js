import { module, test } from 'qunit';
import sinon from 'sinon';
import {
  click,
  currentURL,
  fillIn,
  visit,
  waitUntil,
} from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';

const CLASSIFICATION_URI =
  'http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

/**
 * The organisation of the session: a gemeente, which may request an AGB and
 * a projectvereniging (two types, so the select does not pick one by itself).
 */
const GEMEENTE = {
  type: 'administrative-units',
  id: 'org-aalst',
  attributes: { name: 'Gemeente Aalst', 'legal-name': 'Gemeente Aalst' },
  relationships: {
    classification: {
      data: {
        type: 'administrative-unit-classification-codes',
        id: CLASSIFICATION.MUNICIPALITY.id,
      },
    },
  },
};

const LABELS = {
  [CLASSIFICATION.MUNICIPALITY.id]: 'Gemeente',
  [CLASSIFICATION.AGB.id]: 'Autonoom gemeentebedrijf',
  [CLASSIFICATION.PROJECTVERENIGING.id]: 'Projectvereniging',
};

const CREATABLE = [CLASSIFICATION.AGB.id, CLASSIFICATION.PROJECTVERENIGING.id];

function codeResource(id) {
  return {
    type: 'administrative-unit-classification-codes',
    id,
    attributes: { label: LABELS[id] ?? id },
  };
}

/** The texts of the options of the open power select. */
function optionTexts() {
  return [...document.querySelectorAll('.ember-power-select-option')].map(
    (option) => option.textContent.trim(),
  );
}

/** Opens the power select with this trigger id and picks the option with this text. */
async function choose(triggerId, label) {
  await click(`#${triggerId}`);
  const option = [
    ...document.querySelectorAll('.ember-power-select-option'),
  ].find((element) => element.textContent.includes(label));
  if (!option) {
    throw new Error(
      `no option "${label}" in #${triggerId}; the options are: ${optionTexts().join(', ')}`,
    );
  }
  await click(option);
}

module('Acceptance | nieuwe organisatie aanvragen', function (hooks) {
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
                attributes: { 'first-name': 'Test', 'family-name': 'Aalst' },
              },
            ],
          };
        case 'organization':
        case 'administrative-unit':
          return {
            data: structuredClone(GEMEENTE),
            included: [codeResource(CLASSIFICATION.MUNICIPALITY.id)],
          };
        case 'change-event-type':
          return {
            data: {
              type: 'change-event-types',
              id,
              attributes: { label: 'Oprichting' },
            },
          };
        case 'organization-classification-code':
        case 'administrative-unit-classification-code':
          return { data: codeResource(id) };
        default:
          return { data: null };
      }
    });
    // The classification select asks for the codes it may offer by id
    sinon.stub(adapter, 'query').callsFake(async (store, schema, query) => {
      if (schema.modelName === 'organization-classification-code') {
        const ids = String(query['filter[:id:]'] ?? '').split(',');
        return { data: ids.filter((id) => LABELS[id]).map(codeResource) };
      }
      return { data: [] };
    });
    sinon.stub(adapter, 'findAll').resolves({ data: [] });
    this.fetch = sinon.stub(window, 'fetch').callsFake(async (url) => {
      const { pathname } = new URL(url, window.location.origin);
      if (pathname === '/change-requests/permissions') {
        return jsonResponse(200, {
          'can-decide': false,
          'can-create': CREATABLE.map((id) => CLASSIFICATION_URI + id),
        });
      }
      if (pathname.startsWith('/scope-of-operation/')) {
        return jsonResponse(200, []);
      }
      return jsonResponse(404, { errors: [{ status: '404' }] });
    });

    await authenticateSession({
      relationships: {
        account: { data: { type: 'accounts', id: 'account-1' } },
        group: { data: { type: 'groups', id: 'org-aalst' } },
      },
    });
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('the form opens for a gemeente, offers the types it may request, and asks for the KBO number once a type is chosen', async function (assert) {
    await visit('/organisaties/nieuwe-organisatie');

    assert.strictEqual(currentURL(), '/organisaties/nieuwe-organisatie');
    assert.dom('[data-test-submit-request]').exists();
    assert
      .dom('#change-event-date')
      .exists('the oprichting card, with its date');
    assert.dom('#kbo-identifier').doesNotExist('no type chosen yet');

    await click('#classification-select');
    assert.deepEqual(
      optionTexts().sort(),
      ['Autonoom gemeentebedrijf', 'Projectvereniging'],
      'the types the service lets this gemeente request',
    );
    await click(
      [...document.querySelectorAll('.ember-power-select-option')].find(
        (option) => option.textContent.includes('Autonoom gemeentebedrijf'),
      ),
    );

    assert
      .dom('#kbo-identifier')
      .exists('an AGB is registered with its KBO number');
    assert.dom('#legal-form-select').exists();
  });

  test('a KBO number that is not ten digits is explained on the field, and nothing is sent', async function (assert) {
    await visit('/organisaties/nieuwe-organisatie');
    await choose('classification-select', 'Autonoom gemeentebedrijf');
    await fillIn('#kbo-identifier', '123');
    await click('[data-test-submit-request]');

    const kboItem = document
      .querySelector('#kbo-identifier')
      .closest('.au-c-card-item');
    await waitUntil(() => kboItem.querySelector('.au-c-help-text--error'), {
      timeoutMessage: 'the KBO field shows no error',
    });
    assert.dom(kboItem).includesText('Vul het (tiencijferige) KBO nummer in.');
    assert.dom(kboItem).doesNotIncludeText('[object Object]');
    assert.true(
      this.fetch.withArgs('/change-requests').notCalled,
      'nothing is sent',
    );
  });
});
