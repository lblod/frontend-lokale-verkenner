import { module, test } from 'qunit';
import sinon from 'sinon';
import { click, currentURL, find, findAll, visit } from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { ABB_CLASSIFICATION_ID } from 'frontend-organization-portal/controllers/aanvragen/index';

/**
 * The organisations the pages name: ABB (the session's), a gemeente that
 * requests, and an AGB that is registered.
 */
const ORGANIZATIONS = {
  'org-abb': ['Agentschap Binnenlands Bestuur', ABB_CLASSIFICATION_ID],
  'org-aalst': ['Gemeente Aalst', CLASSIFICATION.MUNICIPALITY.id],
  'org-agb': ['AGB Aalst', CLASSIFICATION.AGB.id],
};

const CLASSIFICATION_LABELS = {
  [ABB_CLASSIFICATION_ID]: 'Agentschap Binnenlands Bestuur',
  [CLASSIFICATION.MUNICIPALITY.id]: 'Gemeente',
  [CLASSIFICATION.AGB.id]: 'Autonoom gemeentebedrijf',
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

function organizationResource(id) {
  const [name, classificationId] = ORGANIZATIONS[id];
  return {
    type: 'administrative-units',
    id,
    attributes: { name, 'legal-name': name },
    relationships: {
      classification: {
        data: {
          type: 'administrative-unit-classification-codes',
          id: classificationId,
        },
      },
    },
  };
}

function classificationResource(id) {
  return {
    type: 'administrative-unit-classification-codes',
    id,
    attributes: { label: CLASSIFICATION_LABELS[id] ?? id },
  };
}

/**
 * Request number `n` of 25: creations by Aalst. The first waits, so its
 * organisation is not registered yet; the second was rejected, so its
 * organisation was never registered; the others are applied and about the
 * registered AGB.
 */
function requestDocument(n) {
  const id = `cr-${String(n).padStart(2, '0')}`;
  let target = { data: { type: 'organizations', id: 'org-agb' } };
  let status = 'afgehandeld';
  if (n === 1) {
    status = 'ingediend';
    target = {
      data: { type: 'organizations', id: 'org-new-1' },
      meta: { registered: false, pending: true },
    };
  } else if (n === 2) {
    status = 'afgekeurd';
    target = {
      data: { type: 'organizations', id: 'org-new-2' },
      meta: { registered: false, pending: false },
    };
  }
  return {
    type: 'change-requests',
    id,
    attributes: {
      kind: 'creation',
      status,
      created: `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`,
      mine: false,
      'target-name': `Organisatie ${n}`,
      'target-classification': CLASSIFICATION.AGB.id,
      steps: [
        {
          sequence: 1,
          type: 'indiening',
          status: 'ingediend',
          at: '2026-10-01T10:00:00.000Z',
          agent: 'user',
          organisation: 'org-aalst',
        },
      ],
      conflicts: [],
      'conflicts-token': null,
      operations: [],
    },
    relationships: {
      target,
      'requesting-organisation': {
        data: { type: 'organizations', id: 'org-aalst' },
      },
    },
  };
}

/**
 * A request by Aalst whose apply failed, an `edit` or a `creation` of the
 * AGB: the service kept it with status mislukt and the error of the apply.
 */
function failedRequestDocument(kind) {
  const document = requestDocument(3);
  return {
    ...document,
    id: `cr-failed-${kind}`,
    attributes: {
      ...document.attributes,
      kind,
      status: 'mislukt',
      error: 'Virtuoso 42000 Error SR325: Transaction aborted',
    },
  };
}

module('Acceptance | aanvragen', function (hooks) {
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
                attributes: { 'first-name': 'Test', 'family-name': 'ABB' },
              },
            ],
          };
        case 'organization':
          return {
            data: organizationResource(id),
            included: [classificationResource(ORGANIZATIONS[id][1])],
          };
        case 'organization-classification-code':
          return { data: classificationResource(id) };
        default:
          return { data: null };
      }
    });
    sinon.stub(adapter, 'query').callsFake(async (store, schema, query) => {
      if (schema.modelName === 'organization') {
        const ids = String(query.filter?.id ?? '').split(',');
        return {
          data: ids.filter((id) => ORGANIZATIONS[id]).map(organizationResource),
        };
      }
      if (schema.modelName === 'organization-classification-code') {
        return {
          data: Object.keys(CLASSIFICATION_LABELS).map(classificationResource),
        };
      }
      return { data: [] };
    });

    // The change-request service: 25 requests, a page of 20 at most, and
    // the failed ones. The session is ABB's unless a test says otherwise.
    this.canDecide = true;
    this.fetch = sinon.stub(window, 'fetch').callsFake(async (url) => {
      const { pathname, searchParams } = new URL(url, window.location.origin);
      if (pathname === '/change-requests/permissions') {
        return jsonResponse(200, {
          'can-decide': this.canDecide,
          'can-create': [],
        });
      }
      if (pathname === '/change-requests') {
        const page = Number(searchParams.get('page[number]'));
        const size = Number(searchParams.get('page[size]'));
        const all = Array.from({ length: 25 }, (_, index) =>
          requestDocument(index + 1),
        );
        return jsonResponse(200, {
          data: all.slice(page * size, page * size + size),
          meta: { count: all.length },
        });
      }
      const match = pathname.match(/^\/change-requests\/cr-(\d+)$/);
      if (match && Number(match[1]) <= 25) {
        return jsonResponse(200, { data: requestDocument(Number(match[1])) });
      }
      const failed = pathname.match(/^\/change-requests\/cr-failed-(\w+)$/);
      if (failed) {
        return jsonResponse(200, { data: failedRequestDocument(failed[1]) });
      }
      return jsonResponse(404, { errors: [{ status: '404' }] });
    });

    await authenticateSession({
      relationships: {
        account: { data: { type: 'accounts', id: 'account-1' } },
        group: { data: { type: 'groups', id: 'org-abb' } },
      },
    });
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  function listRequests(fetchStub) {
    return fetchStub
      .getCalls()
      .map(({ args: [url] }) => new URL(url, window.location.origin))
      .filter(({ pathname }) => pathname === '/change-requests');
  }

  function pagerButton(label) {
    return findAll('.au-c-pagination button').find((button) =>
      button.textContent.includes(label),
    );
  }

  test('Alle aanvragen pages through more requests than fit on one page', async function (assert) {
    await visit('/aanvragen');

    assert.strictEqual(findAll('[data-test-target]').length, 20);
    assert.dom('.au-c-pagination').includesText('1 - 20');
    assert.dom('.au-c-pagination').includesText('van 25');
    assert.true(pagerButton('Vorige').disabled);
    assert.false(pagerButton('Volgende').disabled);

    await click(pagerButton('Volgende'));

    assert.true(currentURL().includes('page=1'), currentURL());
    assert.strictEqual(
      listRequests(this.fetch).at(-1).searchParams.get('page[number]'),
      '1',
    );
    assert.strictEqual(findAll('[data-test-target]').length, 5);
    assert.dom('.au-c-pagination').includesText('21 - 25');
    assert.true(pagerButton('Volgende').disabled);
    assert.false(pagerButton('Vorige').disabled);

    await click(pagerButton('Vorige'));

    assert.strictEqual(findAll('[data-test-target]').length, 20);
  });

  test('the organisation of a request links to its page when it is registered, and says why when it is not', async function (assert) {
    await visit('/aanvragen');

    const [waiting, rejected, applied] = findAll('[data-test-target]');
    assert.dom(waiting).hasText('Organisatie 1 (in aanvraag)');
    assert.dom('a', waiting).doesNotExist();
    assert.dom(rejected).hasText('Organisatie 2 (niet geregistreerd)');
    assert.dom('a', rejected).doesNotExist();
    assert.dom('a', applied).hasText('Organisatie 3');
  });

  test('the filters named in the URL show their organisations and classification', async function (assert) {
    await visit(
      `/aanvragen?requester=org-aalst&organization=org-agb&targetClassification=${CLASSIFICATION.AGB.id}`,
    );

    assert
      .dom('[data-test-filter-requester] .ember-power-select-trigger')
      .includesText('Gemeente Aalst');
    assert
      .dom('[data-test-filter-target] .ember-power-select-trigger')
      .includesText('AGB Aalst');
    assert
      .dom('[data-test-filter-classification] .ember-power-select-trigger')
      .includesText('Autonoom gemeentebedrijf');
    const { searchParams } = listRequests(this.fetch).at(-1);
    assert.strictEqual(searchParams.get('filter[requester]'), 'org-aalst');
    assert.strictEqual(searchParams.get('filter[target]'), 'org-agb');
    assert.strictEqual(
      searchParams.get('filter[target-classification]'),
      CLASSIFICATION.AGB.id,
    );
    assert.strictEqual(
      searchParams.get('filter[kind]'),
      null,
      'no kind: the service lists creations and change events',
    );
  });

  test('an old link to the edits lists the requests of every listed kind', async function (assert) {
    await visit('/aanvragen?kind=edit');

    assert.strictEqual(
      listRequests(this.fetch).at(-1).searchParams.get('filter[kind]'),
      null,
    );
    assert
      .dom('#filter-kind')
      .doesNotIncludeText('Wijziging gegevens', 'not offered as a filter');
  });

  test('a request page has the navigation bar back to the list, and a modal left open does not open on the next request', async function (assert) {
    await visit('/aanvragen/cr-01');

    assert.dom('[data-test-request-status]').exists();
    const breadcrumb = findAll('nav[aria-label="breadcrumbs"] a').find(
      (link) => link.textContent.trim() === 'Aanvragen',
    );
    assert.ok(breadcrumb, 'a way back to the list');

    await click('[data-test-action="goedkeuring"]');
    assert.dom('[data-test-step-confirm]').exists('the modal is open');

    await visit('/aanvragen/cr-03');

    assert.dom('[data-test-step-confirm]').doesNotExist();
    assert
      .dom('[data-test-action="goedkeuring"]')
      .doesNotExist('an applied request takes no decision');

    await click(
      findAll('nav[aria-label="breadcrumbs"] a').find(
        (link) => link.textContent.trim() === 'Aanvragen',
      ),
    );
    assert.strictEqual(currentURL(), '/aanvragen');
  });

  test('a request that cannot be fetched says so in Dutch', async function (assert) {
    await visit('/aanvragen/cr-99');

    assert.dom('[data-test-request-error]').includesText('niet gevonden');
    assert.ok(find('[data-test-request-error] a'), 'a link to the list');
  });

  test('a failed request offers ABB no hertoepassing: a creation is rejected or withdrawn, an edit withdrawn', async function (assert) {
    await visit('/aanvragen/cr-failed-creation');

    assert
      .dom('[data-test-status-description]')
      .hasText('Het doorvoeren van de aanvraag mislukte.');
    assert
      .dom('[data-test-banner="failed"]')
      .includesText('Virtuoso 42000 Error SR325: Transaction aborted');
    assert.dom('[data-test-banner="failed"]').doesNotIncludeText('opnieuw');
    assert.dom('[data-test-action="hertoepassing"]').doesNotExist();
    assert.dom('[data-test-action="afkeuring"]').exists();
    assert.dom('[data-test-action="intrekking"]').exists();

    await visit('/aanvragen/cr-failed-edit');

    assert.dom('[data-test-action="hertoepassing"]').doesNotExist();
    assert
      .dom('[data-test-action="afkeuring"]')
      .doesNotExist('no afkeuring of an edit');
    assert.dom('[data-test-action="intrekking"]').exists();
  });

  test('a failed request offers its requester no hertoepassing either: the requester withdraws it', async function (assert) {
    this.canDecide = false;
    await authenticateSession({
      relationships: {
        account: { data: { type: 'accounts', id: 'account-1' } },
        group: { data: { type: 'groups', id: 'org-aalst' } },
      },
    });

    for (const kind of ['edit', 'creation']) {
      await visit(`/aanvragen/cr-failed-${kind}`);

      assert.dom('[data-test-action="hertoepassing"]').doesNotExist(kind);
      assert.dom('[data-test-action="afkeuring"]').doesNotExist(kind);
      assert.dom('[data-test-action="intrekking"]').exists(kind);
      assert.dom('[data-test-banner="failed"]').doesNotIncludeText('opnieuw');
    }
  });
});
