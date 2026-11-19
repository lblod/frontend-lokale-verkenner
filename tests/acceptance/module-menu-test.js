import { module, test } from 'qunit';
import sinon from 'sinon';
import { visit } from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';

/**
 * A gemeente, the kind of organisation whose page shows both links today.
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
    'organization-status': {
      data: { type: 'organization-status-codes', id: 'status-1' },
    },
    identifiers: { data: [] },
  },
};

const INCLUDED = [
  {
    type: 'administrative-unit-classification-codes',
    id: CLASSIFICATION.MUNICIPALITY.id,
    attributes: { label: 'Gemeente' },
  },
  {
    type: 'organization-status-codes',
    id: 'status-1',
    attributes: { label: 'Actief' },
  },
];

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

module('Acceptance | module menu', function (hooks) {
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
              attributes: { 'first-name': 'Test', 'family-name': 'Gemeente' },
            },
          ],
        };
      }
      // A copy: the serializer normalises a document in place
      return structuredClone({ data: GEMEENTE, included: INCLUDED });
    });
    sinon.stub(adapter, 'query').resolves({ data: [] });
    this.fetch = sinon.stub(window, 'fetch').callsFake(async (url) => {
      const { pathname } = new URL(url, window.location.origin);
      if (pathname === '/change-requests/permissions') {
        return jsonResponse(200, {
          'can-edit': false,
          'can-decide': false,
          'can-create': [],
          rules: [],
        });
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

  test('the index offers no Personen module', async function (assert) {
    await visit('/');

    assert.dom('a[href="/personen"]').doesNotExist();
    assert.dom('a[href="/organisaties"]').exists();
    assert.dom('a[href="/aanvragen"]').exists();
    // The whole page: with a selector, only the first matching card is read
    assert.dom().doesNotIncludeText('Personen');
  });

  test("a gemeente's organization page offers no Bestuursorganen or Leidinggevenden link", async function (assert) {
    await visit('/organisaties/org-aalst');

    assert
      .dom('a[href="/organisaties/org-aalst/bestuursorganen"]')
      .doesNotExist();
    assert
      .dom('a[href="/organisaties/org-aalst/leidinggevenden"]')
      .doesNotExist();
    assert.dom('a[href="/organisaties/org-aalst/kerngegevens"]').exists();
    assert.dom('a[href="/organisaties/org-aalst/vestigingen"]').exists();
  });
});
