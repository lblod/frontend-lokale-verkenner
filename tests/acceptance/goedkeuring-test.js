import { module, test } from 'qunit';
import sinon from 'sinon';
import { click, visit, waitFor } from '@ember/test-helpers';
import { authenticateSession } from 'ember-simple-auth/test-support';
import { setupApplicationTest } from 'frontend-organization-portal/tests/helpers';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';
import { ABB_CLASSIFICATION_ID } from 'frontend-organization-portal/controllers/aanvragen/index';

/**
 * A naamswijziging of Aalst that waits for ABB.
 */
const REQUEST_ID = 'cr-naamswijziging';

/**
 * The tokens the service gives for the conflicts of the request: the one its
 * GET shows, and another one once the data changed again.
 */
const TOKEN_SHOWN = 'a1b2c3d4e5f60718';
const TOKEN_LATER = 'f6e5d4c3b2a10817';

const ORGANIZATIONS = {
  'org-abb': ['Agentschap Binnenlands Bestuur', ABB_CLASSIFICATION_ID],
  'org-aalst': ['Gemeente Aalst', CLASSIFICATION.MUNICIPALITY.id],
};

const CLASSIFICATION_LABELS = {
  [ABB_CLASSIFICATION_ID]: 'Agentschap Binnenlands Bestuur',
  [CLASSIFICATION.MUNICIPALITY.id]: 'Gemeente',
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
 * A conflict on the name of Aalst, as the service computes it: the request
 * proposes "Stad Aalst" for the name the form showed, and someone renamed
 * the organisation to `current` meanwhile.
 */
function nameConflict(current) {
  return {
    resource: { type: 'administrative-units', id: 'org-aalst' },
    key: 'name',
    base: 'Gemeente Aalst',
    current,
    proposed: 'Stad Aalst',
    'competing-requests': [],
  };
}

const SUBMISSION = {
  sequence: 1,
  type: 'indiening',
  status: 'ingediend',
  at: '2026-10-01T10:00:00.000Z',
  agent: 'user',
  person: 'person-aalst',
  organisation: 'org-aalst',
  rule: 'own-organisation',
  reason: null,
};

/**
 * The request as the service answers it: waiting, with the conflicts its
 * GET shows live and their token, or applied.
 */
function requestDocument({
  status = 'ingediend',
  conflicts = [],
  token = null,
  steps = [SUBMISSION],
} = {}) {
  return {
    type: 'change-requests',
    id: REQUEST_ID,
    attributes: {
      kind: 'change-event',
      status,
      created: '2026-10-01T10:00:00.000Z',
      mine: false,
      'target-name': 'Gemeente Aalst',
      'target-classification': CLASSIFICATION.MUNICIPALITY.id,
      'applied-at': null,
      error: null,
      steps,
      conflicts,
      'conflicts-token': token,
      competing: [],
      operations: [
        {
          op: 'update',
          data: {
            type: 'administrative-units',
            id: 'org-aalst',
            attributes: { name: 'Stad Aalst' },
          },
        },
      ],
    },
    relationships: {
      target: { data: { type: 'organizations', id: 'org-aalst' } },
      'requesting-organisation': {
        data: { type: 'organizations', id: 'org-aalst' },
      },
    },
  };
}

/**
 * The request once ABB approved it over the given conflicts: the service
 * applied it and records what the afhandeling overrode.
 */
function appliedDocument(overriddenConflicts) {
  return requestDocument({
    status: 'afgehandeld',
    steps: [
      SUBMISSION,
      {
        sequence: 2,
        type: 'goedkeuring',
        status: 'goedgekeurd',
        at: '2026-10-02T10:00:00.000Z',
        agent: 'user',
        person: 'person-abb',
        organisation: 'org-abb',
        rule: 'abb-decides-all',
        reason: null,
      },
      {
        sequence: 3,
        type: 'afhandeling',
        status: 'afgehandeld',
        at: '2026-10-02T10:00:01.000Z',
        agent: 'service',
        person: null,
        organisation: null,
        rule: null,
        reason: null,
        'overrides-conflict': true,
        'overridden-conflicts': overriddenConflicts,
      },
    ],
  });
}

/**
 * The 409 of a goedkeuring without the token of the current conflicts.
 */
function conflictsResponse(conflicts, token) {
  return jsonResponse(409, {
    errors: [
      {
        status: '409',
        title: 'The data changed since the request was submitted',
        meta: { conflicts, 'conflicts-token': token },
      },
    ],
  });
}

module('Acceptance | goedkeuring over gewijzigde gegevens', function (hooks) {
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
    sinon.stub(adapter, 'query').resolves({ data: [] });

    // The change-request service, as ABB sees it: the request as it is now
    // (`this.document`), and the steps posted on it, answered by
    // `this.answerStep`
    this.document = requestDocument();
    this.postedSteps = [];
    this.answerStep = () => jsonResponse(500, { errors: [] });
    this.fetch = sinon.stub(window, 'fetch').callsFake(async (url, init) => {
      const { pathname } = new URL(url, window.location.origin);
      if (pathname === '/change-requests/permissions') {
        return jsonResponse(200, { 'can-decide': true, 'can-create': [] });
      }
      if (pathname === `/change-requests/${REQUEST_ID}`) {
        return jsonResponse(200, { data: this.document });
      }
      if (
        pathname === `/change-requests/${REQUEST_ID}/steps` &&
        init?.method === 'POST'
      ) {
        const { attributes } = JSON.parse(init.body).data;
        this.postedSteps.push(attributes);
        return this.answerStep(attributes);
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

  /**
   * The service applies the request for a goedkeuring with `token` and
   * refuses any other with the given conflicts and that token.
   */
  function applyWithToken(context, conflicts, token) {
    context.answerStep = (attributes) => {
      if (attributes.override !== token) {
        return conflictsResponse(conflicts, token);
      }
      context.document = appliedDocument(conflicts);
      return jsonResponse(201, { data: context.document });
    };
  }

  test('ABB sees the data that changed since the submission and approves over it with the token of those conflicts', async function (assert) {
    this.document = requestDocument({
      conflicts: [nameConflict('Aalst')],
      token: TOKEN_SHOWN,
    });
    applyWithToken(this, [nameConflict('Aalst')], TOKEN_SHOWN);

    await visit(`/aanvragen/${REQUEST_ID}`);

    assert.dom('[data-test-request-status]').hasText('Ingediend');
    assert
      .dom('[data-test-banner="conflicts"]')
      .exists('the page warns that the data changed');

    await click('[data-test-action="goedkeuring"]');

    assert
      .dom('[data-test-step-conflicts]')
      .includesText('Naam: nu Aalst, de aanvraag stelt Stad Aalst voor');
    assert.dom('[data-test-step-override]').isNotChecked();

    await click('[data-test-step-confirm]');

    assert
      .dom('[data-test-step-error]')
      .includesText(
        'Bevestig dat je de intussen gewijzigde gegevens hebt bekeken',
      );
    assert.deepEqual(
      this.postedSteps,
      [],
      'nothing is sent before the differences are confirmed',
    );

    await click('[data-test-step-override]');
    await click('[data-test-step-confirm]');
    await waitFor('[data-test-toast]');

    assert.deepEqual(
      this.postedSteps,
      [{ 'step-type': 'goedkeuring', override: TOKEN_SHOWN }],
      'the goedkeuring overrides exactly the conflicts shown',
    );
    assert
      .dom('[data-test-toast]')
      .includesText('De aanvraag is goedgekeurd en doorgevoerd.');
    assert.dom('[data-test-step-confirm]').doesNotExist('the modal closed');
    assert.dom('[data-test-request-status]').hasText('Afgehandeld');
    assert.dom('[data-test-action="goedkeuring"]').doesNotExist();
    assert.dom('[data-test-banner="conflicts"]').doesNotExist();
  });

  test('a change that lands after the page loaded refuses the goedkeuring: the modal shows the differences and asks to confirm them', async function (assert) {
    // Nothing had changed when the page loaded; the service finds a
    // conflict when the goedkeuring arrives
    this.document = requestDocument();
    applyWithToken(this, [nameConflict('Aalst (fusie)')], TOKEN_LATER);

    await visit(`/aanvragen/${REQUEST_ID}`);

    assert.dom('[data-test-banner="conflicts"]').doesNotExist();

    await click('[data-test-action="goedkeuring"]');

    assert.dom('[data-test-step-conflicts]').doesNotExist();

    await click('[data-test-step-confirm]');
    await waitFor('[data-test-step-conflicts]');

    assert.deepEqual(
      this.postedSteps,
      [{ 'step-type': 'goedkeuring' }],
      'approved without a token, as nothing had changed',
    );
    assert
      .dom('[data-test-step-error]')
      .includesText('De gegevens zijn intussen opnieuw gewijzigd');
    assert
      .dom('[data-test-step-conflicts]')
      .includesText(
        'Naam: nu Aalst (fusie), de aanvraag stelt Stad Aalst voor',
      );
    assert
      .dom('[data-test-request-status]')
      .hasText('Ingediend', 'nothing is applied');

    await click('[data-test-step-confirm]');

    assert.strictEqual(
      this.postedSteps.length,
      1,
      'not sent again before the differences are confirmed',
    );

    await click('[data-test-step-override]');
    await click('[data-test-step-confirm]');
    await waitFor('[data-test-toast]');

    assert.deepEqual(this.postedSteps.at(-1), {
      'step-type': 'goedkeuring',
      override: TOKEN_LATER,
    });
    assert.dom('[data-test-request-status]').hasText('Afgehandeld');
  });

  test('a token of conflicts that changed again is refused: the modal shows the current differences, and the confirmation is asked anew', async function (assert) {
    // The page showed one conflict; the data changed once more before ABB
    // confirmed, so the token shown no longer matches
    this.document = requestDocument({
      conflicts: [nameConflict('Aalst')],
      token: TOKEN_SHOWN,
    });
    applyWithToken(this, [nameConflict('Aalst-Erembodegem')], TOKEN_LATER);

    await visit(`/aanvragen/${REQUEST_ID}`);
    await click('[data-test-action="goedkeuring"]');

    assert
      .dom('[data-test-step-conflicts]')
      .includesText('nu Aalst, de aanvraag stelt Stad Aalst voor');

    await click('[data-test-step-override]');
    await click('[data-test-step-confirm]');
    await waitFor('[data-test-step-error]');

    assert.deepEqual(
      this.postedSteps,
      [{ 'step-type': 'goedkeuring', override: TOKEN_SHOWN }],
      'the token of the conflicts shown was sent',
    );
    assert
      .dom('[data-test-step-conflicts]')
      .includesText(
        'nu Aalst-Erembodegem, de aanvraag stelt Stad Aalst voor',
        'the current differences replace the ones shown',
      );
    assert
      .dom('[data-test-step-override]')
      .isNotChecked('the confirmation is asked anew');
    assert.dom('[data-test-request-status]').hasText('Ingediend');

    await click('[data-test-step-override]');
    await click('[data-test-step-confirm]');
    await waitFor('[data-test-toast]');

    assert.deepEqual(this.postedSteps.at(-1), {
      'step-type': 'goedkeuring',
      override: TOKEN_LATER,
    });
    assert.dom('[data-test-request-status]').hasText('Afgehandeld');
    assert.dom('[data-test-step-confirm]').doesNotExist();
  });
});
