import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

const REQUESTER = 'org-1';
const OTHER = 'org-2';

module('Unit | Controller | aanvragen/aanvraag', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.controller = this.owner.lookup('controller:aanvragen/aanvraag');
    this.session = this.owner.lookup('service:current-session');
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  function model({
    status,
    steps = [],
    canDecide = false,
    conflicts = [],
    kind = 'creation',
  }) {
    return {
      request: {
        id: 'cr-1',
        attributes: { status, steps, conflicts, kind, mine: false },
        relationships: {
          'requesting-organisation': {
            data: { type: 'organizations', id: REQUESTER },
          },
        },
      },
      requesterId: REQUESTER,
      requester: { id: REQUESTER, abbName: 'Gemeente Aalst' },
      rights: { canDecide, canCreate: [] },
    };
  }

  function actsFor(controller, session, organizationId) {
    sinon.stub(session, 'organizationId').get(() => organizationId);
    return controller;
  }

  test('ABB decides on a submitted request: approve, reject, ask for information, withdraw; the requester only withdraws', function (assert) {
    const { controller, session } = this;
    actsFor(controller, session, OTHER);
    controller.model = model({ status: 'ingediend', canDecide: true });

    assert.true(controller.canApprove);
    assert.true(controller.canReject);
    assert.true(controller.canAskInformation);
    assert.true(controller.canWithdraw);
    assert.false(controller.canAnswer);
    assert.false(controller.canContest);
    assert.true(controller.hasActions);

    controller.model = model({ status: 'ingediend', canDecide: false });
    sinon.restore();
    actsFor(controller, session, REQUESTER);
    assert.false(controller.canApprove);
    assert.false(controller.canReject);
    assert.false(controller.canAskInformation);
    assert.true(
      controller.canWithdraw,
      'the requester withdraws its own request',
    );
    assert.true(controller.isRequester);
  });

  test('a question of ABB is answered by the requester; a rejection is contested by the requester; a failed apply is rejected or withdrawn by ABB', function (assert) {
    const { controller, session } = this;
    actsFor(controller, session, REQUESTER);
    const question = {
      type: 'informatievraag',
      reason: 'Welk besluit?',
      organisation: 'abb',
    };
    controller.model = model({
      status: 'informatie-gevraagd',
      steps: [{ type: 'indiening', organisation: REQUESTER }, question],
    });

    assert.true(controller.canAnswer);
    assert.strictEqual(controller.openQuestion, question);
    assert.false(controller.canApprove);
    assert.true(controller.canWithdraw, 'still pending');

    const rejection = { type: 'afkeuring', reason: 'Nee', organisation: 'abb' };
    controller.model = model({
      status: 'afgekeurd',
      steps: [{ type: 'indiening', organisation: REQUESTER }, rejection],
    });
    assert.true(controller.canContest);
    assert.strictEqual(controller.rejection, rejection);
    assert.false(
      controller.canWithdraw,
      'a rejected request is contested, not withdrawn',
    );
    assert.false(controller.isPending);

    sinon.restore();
    actsFor(controller, session, OTHER);
    controller.model = model({ status: 'mislukt', canDecide: true });
    assert.true(controller.canReject);
    assert.true(controller.canWithdraw);
    assert.false(controller.canApprove);

    controller.model = model({ status: 'afgehandeld', canDecide: true });
    assert.false(controller.hasActions, 'an applied request is final');

    sinon.restore();
    actsFor(controller, session, REQUESTER);
    controller.model = model({ status: 'mislukt' });
    assert.true(controller.canWithdraw, 'the requester withdraws it');
    assert.false(controller.canReject);
  });

  test('a failed edit is withdrawn, by ABB or the requester; an edit takes no decision step', function (assert) {
    const { controller, session } = this;
    actsFor(controller, session, OTHER);
    controller.model = model({
      status: 'mislukt',
      canDecide: true,
      kind: 'edit',
    });

    assert.true(controller.canWithdraw);
    assert.false(controller.canReject, 'no afkeuring of an edit');
    assert.strictEqual(controller.title, 'Wijziging gegevens');

    sinon.restore();
    actsFor(controller, session, REQUESTER);
    controller.model = model({ status: 'mislukt', kind: 'edit' });
    assert.true(controller.canWithdraw);

    controller.model = model({ status: 'afgekeurd', kind: 'edit' });
    assert.false(controller.canContest, 'no betwisting of an edit');
    controller.model = model({
      status: 'ingediend',
      canDecide: true,
      kind: 'edit',
    });
    assert.false(controller.canApprove);
    assert.false(controller.canAskInformation);
  });

  test('a request that could not be loaded shows its message without actions', function (assert) {
    const { controller, session } = this;
    actsFor(controller, session, OTHER);
    controller.model = {
      error: new ChangeRequestError('De aanvraag werd niet gevonden.', {
        status: 404,
      }),
      rights: { canDecide: true, canCreate: [] },
    };

    assert.strictEqual(controller.request, null);
    assert.strictEqual(controller.title, 'Aanvraag');
    assert.false(controller.hasActions);
    assert.deepEqual(controller.steps, []);
  });

  test('a fresh answer or contest is shown to ABB, as is the question it has not got an answer to', function (assert) {
    const { controller, session } = this;
    actsFor(controller, session, OTHER);
    const answer = {
      type: 'informatieantwoord',
      reason: 'Hier',
      organisation: REQUESTER,
    };
    controller.model = model({
      status: 'ingediend',
      canDecide: true,
      steps: [
        { type: 'indiening' },
        { type: 'informatievraag', reason: '?' },
        answer,
      ],
    });

    assert.strictEqual(controller.freshAnswer, answer);
    assert.strictEqual(controller.freshContest, null);
    assert.strictEqual(controller.openQuestion, null);

    const contest = {
      type: 'betwisting',
      reason: 'Toch wel',
      organisation: REQUESTER,
    };
    controller.model = model({
      status: 'ingediend',
      canDecide: true,
      steps: [
        { type: 'indiening' },
        { type: 'afkeuring', reason: 'Nee' },
        contest,
      ],
    });
    assert.strictEqual(controller.freshContest, contest);
    assert.strictEqual(controller.freshAnswer, null);
  });

  test('a taken step closes the modal, tells the user and reloads the request', async function (assert) {
    const { controller } = this;
    const refresh = sinon
      .stub(this.owner.lookup('service:router'), 'refresh')
      .resolves();
    const success = sinon.stub(this.owner.lookup('service:toaster'), 'success');
    controller.open('afkeuring');
    assert.strictEqual(controller.openStep, 'afkeuring');

    await controller.stepTaken({ id: 'cr-1' }, 'De aanvraag is afgekeurd.');

    assert.strictEqual(controller.openStep, null);
    assert.true(
      success.calledOnceWith('De aanvraag is afgekeurd.', 'Aanvraag'),
    );
    assert.true(refresh.calledOnceWithExactly('aanvragen.aanvraag'));

    controller.open('goedkeuring');
    controller.close();
    assert.strictEqual(controller.openStep, null);
  });

  test('an apply that failed during a step closes the modal, says so and reloads the request', async function (assert) {
    const { controller } = this;
    const refresh = sinon
      .stub(this.owner.lookup('service:router'), 'refresh')
      .resolves();
    const error = sinon.stub(this.owner.lookup('service:toaster'), 'error');
    controller.open('goedkeuring');

    await controller.applyFailed('Het doorvoeren van de aanvraag mislukte.');

    assert.strictEqual(controller.openStep, null);
    assert.true(
      error.calledOnceWith('Het doorvoeren van de aanvraag mislukte.'),
    );
    assert.true(refresh.calledOnceWithExactly('aanvragen.aanvraag'));
  });
});
