import { module, test } from 'qunit';
import sinon from 'sinon';
import {
  click,
  currentURL,
  find,
  findAll,
  triggerEvent,
  visit,
} from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { ABB_CLASSIFICATION_ID } from 'frontend-organization-portal/controllers/aanvragen/index';
import { MergerTypeIdList } from 'frontend-organization-portal/models/change-event-type';

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
 * registered AGB. `requester` is the organisation that submitted it.
 */
function requestDocument(n, requester = 'org-aalst') {
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
          organisation: requester,
        },
      ],
      conflicts: [],
      'conflicts-token': null,
      operations: [],
    },
    relationships: {
      target,
      'requesting-organisation': {
        data: { type: 'organizations', id: requester },
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
        case 'change-event-type':
          return {
            data: {
              type: 'change-event-types',
              id,
              attributes: { label: 'Naamswijziging' },
            },
          };
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
    // A test may set `this.requestOverrides` to replace a request document.
    this.canDecide = true;
    this.requestOverrides = {};
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
      const override = this.requestOverrides[pathname];
      if (override) {
        return jsonResponse(200, { data: override });
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

  test('the requester in a row links to its organisation page', async function (assert) {
    await visit('/aanvragen');

    const requester = findAll('tbody tr')[0].children[1];
    const link = requester.querySelector('a');
    assert.dom(requester).includesText('Gemeente Aalst');
    assert.ok(link, 'the requester links its page');
    assert.strictEqual(
      link.getAttribute('href'),
      '/organisaties/org-aalst',
      'to the requesting organisation',
    );
  });

  test('Enkel mijn aanvragen tonen switches between my requests and all of them', async function (assert) {
    await visit('/aanvragen');

    const mine = () => find('[data-test-filter-mine]');
    assert.strictEqual(mine().type, 'checkbox', 'a toggle, not a radio pair');
    assert.false(mine().checked, 'all requests first');

    await click(mine());
    assert.true(mine().checked);
    assert.true(currentURL().includes('mine=true'), currentURL());
    assert.strictEqual(
      listRequests(this.fetch).at(-1).searchParams.get('filter[mine]'),
      'true',
    );

    await click(mine());
    assert.false(currentURL().includes('mine=true'), currentURL());
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

  test('a request page is titled "Aanvraagformulier", names who asked and its state', async function (assert) {
    await visit('/aanvragen/cr-01');

    assert.dom('h1').includesText('Aanvraagformulier');
    assert.dom('[data-test-request-status]').hasText('In behandeling');
    assert.dom('[data-test-status-description]').doesNotExist();
    const requestedBy = find('[data-test-requested-by]');
    assert.dom(requestedBy).includesText('Aangevraagd door');
    assert.dom(requestedBy).includesText('Gemeente Aalst');
    assert.dom('[data-test-action="goedkeuring"]').hasText('Goedkeuren');
    assert.dom('[data-test-action="afkeuring"]').hasText('Afkeuren');
    assert
      .dom('[data-test-action="informatievraag"]')
      .hasText('Meer informatie opvragen');
  });

  test('the form shows one Organisation section, built from the operations', async function (assert) {
    const document = requestDocument(1);
    this.requestOverrides['/change-requests/cr-01'] = {
      ...document,
      attributes: {
        ...document.attributes,
        operations: [
          {
            op: 'create',
            data: {
              type: 'administrative-units',
              id: 'org-new-1',
              attributes: { name: 'Nieuwe organisatie' },
              relationships: {},
            },
          },
        ],
      },
    };

    await visit('/aanvragen/cr-01');

    assert.dom('[data-test-request-form-organization]').exists({ count: 1 });
    assert
      .dom('[data-test-request-form-organization]')
      .includesText('Nieuwe organisatie');
  });

  test('the request page has a sidebar with the request name and its two pages, and the breadcrumb follows the page', async function (assert) {
    await visit('/aanvragen/cr-01');

    assert
      .dom('[data-test-request-name]')
      .hasText('Organisatie 1', 'the sidebar names the request');
    const links = findAll('.au-c-sidebar .au-c-list-navigation a');
    assert.deepEqual(
      links.map((link) => link.textContent.trim()),
      ['Aanvraagformulier', 'Aanvraaggeschiedenis'],
    );
    assert.true(links[0].classList.contains('active'), 'the form is active');
    assert.false(links[1].classList.contains('active'));

    await click(links[1]);

    assert.true(currentURL().endsWith('/geschiedenis'), currentURL());
    assert
      .dom('[data-test-history]')
      .exists('the history replaced the form, the sidebar stays');
    assert.dom('[data-test-request-name]').hasText('Organisatie 1');
    assert
      .dom('[data-test-requested-by]')
      .doesNotExist('the form header and its actions are not on the history');
    assert
      .dom('h1')
      .hasText('Aanvraaggeschiedenis', "one heading, the page's own");
    const crumbs = findAll('nav[aria-label="breadcrumbs"] li').map((item) =>
      item.textContent.trim(),
    );
    assert.deepEqual(crumbs.slice(-3), [
      'Alle aanvragen',
      'Aanvraag Organisatie 1',
      'Aanvraaggeschiedenis',
    ]);
  });

  test('the history shortens a long detail and shows the full text in a tooltip', async function (assert) {
    const document = requestDocument(1);
    const reason =
      'Het KBO-nummer klopt niet en de juridische naam is verouderd.';
    this.requestOverrides['/change-requests/cr-01'] = {
      ...document,
      attributes: {
        ...document.attributes,
        steps: [
          ...document.attributes.steps,
          { type: 'afkeuring', reason, status: 'afgekeurd' },
        ],
      },
    };

    await visit('/aanvragen/cr-01/geschiedenis');

    const details = find(
      '[data-test-history] tbody tr:first-child td:nth-child(3)',
    );
    assert.true(
      details.textContent.trim().endsWith('…'),
      'the cell is shortened',
    );
    assert.notOk(details.textContent.includes(reason), 'not the full text');
    await triggerEvent(details.querySelector('[tabindex="0"]'), 'mouseenter');
    assert.dom('[role="tooltip"]').includesText(reason);
  });

  test('a request page has the breadcrumb back to the list, and a modal left open does not open on the next request', async function (assert) {
    await visit('/aanvragen/cr-01');

    assert.dom('[data-test-request-status]').exists();
    const crumbs = findAll('nav[aria-label="breadcrumbs"] li').map((item) =>
      item.textContent.trim(),
    );
    assert.deepEqual(
      crumbs.slice(-3),
      ['Alle aanvragen', 'Aanvraag Organisatie 1', 'Aanvraagformulier'],
      'the way back is the breadcrumb, as the design shows it',
    );

    await click('[data-test-action="goedkeuring"]');
    assert.dom('[data-test-step-confirm]').exists('the modal is open');

    await visit('/aanvragen/cr-03');

    assert.dom('[data-test-step-confirm]').doesNotExist();
    assert
      .dom('[data-test-action="goedkeuring"]')
      .doesNotExist('an applied request takes no decision');

    await click(
      findAll('nav[aria-label="breadcrumbs"] a').find(
        (link) => link.textContent.trim() === 'Alle aanvragen',
      ),
    );
    assert.strictEqual(currentURL(), '/aanvragen');
  });

  test('a request that cannot be fetched says so in Dutch', async function (assert) {
    await visit('/aanvragen/cr-99');

    assert.dom('[data-test-request-error]').includesText('niet gevonden');
    assert.ok(find('[data-test-request-error] a'), 'a link to the list');
  });

  test('an answered request shows the answer in its banner, and the request page has no extra informatie tab', async function (assert) {
    const document = requestDocument(1);
    this.requestOverrides['/change-requests/cr-01'] = {
      ...document,
      attributes: {
        ...document.attributes,
        steps: [
          ...document.attributes.steps,
          { type: 'informatievraag', reason: 'Welk besluit?' },
          { type: 'informatieantwoord', reason: 'Zie bijlage' },
        ],
      },
    };

    await visit('/aanvragen/cr-01');

    const answer = '[data-test-banner="answer"]';
    assert
      .dom(answer)
      .includesText('De aanvrager heeft de aanvullende informatie bezorgd.');
    assert
      .dom(answer)
      .doesNotIncludeText('Zie bijlage', 'the answer is not shown');
    assert.dom(`${answer} a`).hasText('Bekijk de aanvullende informatie.');
    assert.strictEqual(
      find(`${answer} a`).getAttribute('href'),
      '/aanvragen/cr-01/geschiedenis',
    );
    assert
      .dom('nav a')
      .doesNotIncludeText('Extra informatie', 'the frames have no such tab');
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

  test('a failed request offers ABB no hertoepassing: a creation is rejected or withdrawn, an edit withdrawn', async function (assert) {
    await visit('/aanvragen/cr-failed-creation');

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

  test('the requester reads the rejection in its banner and contests from it, and answers a question from its banner', async function (assert) {
    this.canDecide = false;
    await authenticateSession({
      relationships: {
        account: { data: { type: 'accounts', id: 'account-1' } },
        group: { data: { type: 'groups', id: 'org-aalst' } },
      },
    });
    const submitted = requestDocument(1, 'org-aalst');
    this.requestOverrides['/change-requests/cr-02'] = {
      ...submitted,
      id: 'cr-02',
      attributes: {
        ...submitted.attributes,
        status: 'afgekeurd',
        steps: [
          ...submitted.attributes.steps,
          { type: 'afkeuring', reason: 'Het KBO-nummer klopt niet' },
        ],
      },
    };
    this.requestOverrides['/change-requests/cr-01'] = {
      ...submitted,
      attributes: {
        ...submitted.attributes,
        status: 'informatie-gevraagd',
        steps: [
          ...submitted.attributes.steps,
          {
            type: 'informatievraag',
            reason: 'Welk besluit?',
            organisation: 'org-aalst',
          },
        ],
      },
    };

    await visit('/aanvragen/cr-02');

    const rejection = '[data-test-banner="rejection"]';
    assert.dom('[data-test-request-status]').hasText('Afgekeurd');
    assert
      .dom(rejection)
      .includesText('Deze aanvraag is afgekeurd met de volgende reden:');
    assert
      .dom('[data-test-action="betwisting-link"]')
      .includesText('Laat het ons weten en leg uit waarom.');
    assert
      .dom('[data-test-action="betwisting-link"]')
      .includesText('We bekijken je aanvraag opnieuw.');
    assert
      .dom('[data-test-action="reconsider-link"]')
      .doesNotExist('one link carries both sentences');

    await click('[data-test-action="betwisting-link"]');

    assert.dom('[data-test-step-confirm]').hasText('Verzenden');
    assert
      .dom(this.element)
      .includesText('Waarom ben je het niet eens met de beslissing?');
    assert
      .dom(this.element)
      .includesText(
        'Leg uit waarom je vindt dat de aanvraag toch goedgekeurd moet worden. Wees zo grondig mogelijk.',
      );

    await visit('/aanvragen/cr-01');

    const question = '[data-test-banner="question"]';
    assert
      .dom(question)
      .includesText('De reviewer verwacht aanvullende informatie:');
    assert.dom(question).includesText('Welk besluit?');
    assert
      .dom('[data-test-banner="question"] .au-c-button')
      .hasText('Antwoord op aanvullende vraag.');

    await click('[data-test-banner="question"] .au-c-button');

    assert.dom('[data-test-step-confirm]').hasText('Verzenden');
    assert.dom('[data-test-step-label]').includesText('Welk besluit?');
  });

  test('a change-event request shows the change event, its result and its besluit', async function (assert) {
    const document = requestDocument(1);
    this.requestOverrides['/change-requests/cr-01'] = {
      ...document,
      attributes: {
        ...document.attributes,
        kind: 'change-event',
        aggregate: 'change-event',
        'target-name': 'Gemeente Aalst',
        operations: [
          {
            op: 'create',
            data: {
              type: 'decisions',
              lid: 'decision-1',
              attributes: {
                'document-links': ['https://aalst.be/besluiten/2026/124'],
                'publication-date': '2026-10-01',
              },
            },
          },
          {
            op: 'create',
            data: {
              type: 'change-events',
              lid: 'event-1',
              attributes: {
                date: '2026-10-01',
                description: 'Naamswijziging',
              },
              relationships: {
                type: {
                  data: {
                    type: 'change-event-types',
                    id: 'type-naamswijziging',
                  },
                },
                decision: { data: { type: 'decisions', lid: 'decision-1' } },
                results: {
                  data: [{ type: 'change-event-results', lid: 'result-1' }],
                },
                'original-organizations': {
                  data: [{ type: 'administrative-units', id: 'org-aalst' }],
                },
                'resulting-organizations': {
                  data: [{ type: 'administrative-units', id: 'org-aalst' }],
                },
              },
            },
          },
          {
            op: 'create',
            data: {
              type: 'change-event-results',
              lid: 'result-1',
              attributes: { 'resulting-name': 'Stad Aalst' },
              relationships: {
                'result-from': {
                  data: { type: 'change-events', lid: 'event-1' },
                },
                'resulting-organization': {
                  data: { type: 'administrative-units', id: 'org-aalst' },
                },
                status: {
                  data: {
                    type: 'organization-status-codes',
                    id: 'status-active',
                  },
                },
              },
            },
          },
          {
            op: 'update',
            data: {
              type: 'administrative-units',
              id: 'org-aalst',
              attributes: { name: 'Stad Aalst', 'legal-name': 'Stad Aalst' },
              relationships: {},
            },
          },
        ],
      },
    };

    await visit('/aanvragen/cr-01');

    const card = '[data-test-request-form-change-event]';
    assert.dom(card).includesText('Veranderingsgebeurtenis');
    assert.dom(card).includesText('Type veranderingsgebeurtenis');
    assert.dom(card).includesText('Naamswijziging');
    assert.dom(card).includesText('Datum veranderingsgebeurtenis');
    assert.dom(card).includesText('01-10-2026');
    assert.dom(card).includesText('Nieuwe naam');
    assert.dom(card).includesText('Stad Aalst');
    assert.dom(card).includesText('Links naar besluiten');
    assert.dom(card).includesText('https://aalst.be/besluiten/2026/124');
  });

  test('a multi-organisation change event shows the target organisation result', async function (assert) {
    const document = requestDocument(1);
    this.requestOverrides['/change-requests/cr-01'] = {
      ...document,
      attributes: {
        ...document.attributes,
        kind: 'change-event',
        aggregate: 'change-event',
        'target-name': 'Gemeente Aalst',
        operations: [
          {
            op: 'create',
            data: {
              type: 'change-events',
              lid: 'event-1',
              attributes: { date: '2026-10-01', description: 'Fusie' },
              relationships: {
                type: {
                  data: {
                    type: 'change-event-types',
                    id: MergerTypeIdList[0],
                  },
                },
                'original-organizations': {
                  data: [
                    { type: 'administrative-units', id: 'org-aalst' },
                    { type: 'administrative-units', id: 'org-other' },
                  ],
                },
                'resulting-organizations': {
                  data: [{ type: 'administrative-units', id: 'org-aalst' }],
                },
              },
            },
          },
          {
            op: 'create',
            data: {
              type: 'change-event-results',
              lid: 'result-2',
              attributes: { 'resulting-name': 'Gemeente Other' },
              relationships: {
                'result-from': {
                  data: { type: 'change-events', lid: 'event-1' },
                },
                'resulting-organization': {
                  data: { type: 'administrative-units', id: 'org-other' },
                },
                status: {
                  data: {
                    type: 'organization-status-codes',
                    id: 'status-inactive',
                  },
                },
              },
            },
          },
          {
            op: 'create',
            data: {
              type: 'change-event-results',
              lid: 'result-1',
              attributes: { 'resulting-name': 'Stad Aalst' },
              relationships: {
                'result-from': {
                  data: { type: 'change-events', lid: 'event-1' },
                },
                'resulting-organization': {
                  data: { type: 'administrative-units', id: 'org-aalst' },
                },
                status: {
                  data: {
                    type: 'organization-status-codes',
                    id: 'status-active',
                  },
                },
              },
            },
          },
          {
            op: 'update',
            data: {
              type: 'administrative-units',
              id: 'org-aalst',
              attributes: { name: 'Stad Aalst', 'legal-name': 'Stad Aalst' },
              relationships: {},
            },
          },
        ],
      },
    };

    await visit('/aanvragen/cr-01');

    const card = '[data-test-request-form-change-event]';
    assert.dom(card).includesText('Nieuwe naam');
    assert.dom(card).includesText('Stad Aalst');
    assert.dom(card).doesNotIncludeText('Gemeente Other');

    const organizations = '[data-test-request-form-change-event-organizations]';
    assert.dom(organizations).includesText('status-active');
    assert.dom(organizations).doesNotIncludeText('status-inactive');
  });
});
