import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import NewController from 'frontend-organization-portal/controllers/organizations/organization/sites/new';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import {
  createPrimaryContact,
  createSecondaryContact,
} from 'frontend-organization-portal/models/contact-point';

/**
 * The uuid of a change request the service kept.
 */
const REQUEST_ID = '19a13224-a9d8-4f94-ac7f-74568226d7c5';

module(
  'Unit | Controller | organizations/organization/sites/new',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are built into a lazy bundle (`splitAtRoutes`
    // in ember-cli-build.js), so the controller must be registered before the
    // owner can look it up.
    hooks.beforeEach(function () {
      this.owner.register(
        'controller:organizations/organization/sites/new',
        NewController,
      );
      this.store = this.owner.lookup('service:store');
      this.changeRequests = this.owner.lookup('service:change-requests');
      this.router = this.owner.lookup('service:router');
      this.submit = sinon.stub(this.changeRequests, 'submit');
      this.replaceWith = sinon.stub(this.router, 'replaceWith');
      this.refresh = sinon.stub(this.router, 'refresh');
      const toaster = this.owner.lookup('service:toaster');
      this.warning = sinon.stub(toaster, 'warning');
      this.success = sinon.stub(toaster, 'success');
      this.controller = this.owner.lookup(
        'controller:organizations/organization/sites/new',
      );
      this.controller.model = this.newSiteModel();
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    /**
     * The model of the route: a persisted organisation and the new site with
     * its address and contact points, filled in as a valid form would.
     */
    this.newSiteModel = function () {
      const [organization, siteType] = this.store.push({
        data: [
          {
            type: 'organization',
            id: 'org-1',
            attributes: { name: 'Gemeente Test' },
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
      const address = this.store.createRecord('address', {
        street: 'Kerkstraat',
        number: '1',
        boxNumber: '',
        postcode: '9000',
        municipality: 'Gent',
        province: 'Oost-Vlaanderen',
        country: 'België',
      });
      const contact = createPrimaryContact(this.store);
      contact.email = 'info@gent.be';
      contact.telephone = '';

      return {
        organization,
        site: this.store.createRecord('site', { siteType }),
        address,
        contact,
        secondaryContact: createSecondaryContact(this.store),
      };
    };

    test('it submits the site aggregate, dependencies first, and opens the new site', async function (assert) {
      const { organization, site, address, contact, secondaryContact } =
        this.controller.model;
      const savedSite = { id: 'site-1' };
      this.submit.resolves(new Map([[site, savedSite]]));

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.notOk(this.controller.hasValidationErrors);
      assert.true(this.submit.calledOnce);
      const [aggregate, target, records] = this.submit.firstCall.args;
      assert.strictEqual(aggregate, 'site');
      assert.strictEqual(target, 'org-1');
      assert.deepEqual(records, [
        contact,
        secondaryContact,
        address,
        site,
        organization,
      ]);
      assert.strictEqual(
        address.fullAddress,
        'Kerkstraat 1, 9000 Gent, België',
      );
      assert.strictEqual(contact.telephone, null, 'empty strings become null');
      assert.strictEqual(site.belongsTo('address').value(), address);
      assert.deepEqual(site.hasMany('contacts').value().slice(), [
        contact,
        secondaryContact,
      ]);
      assert.deepEqual(
        organization.hasMany('sites').value().slice(),
        [site],
        'the site is added to the organisation before the request is sent',
      );
      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'organizations.organization.sites.site',
          'site-1',
        ),
        'the page of the site is opened under the id the backend minted',
      );
      assert.strictEqual(this.controller.saveError, null);
    });

    test('it makes the site the primary site when asked', async function (assert) {
      const { organization, site } = this.controller.model;
      this.controller.isPrimarySite = true;
      this.submit.resolves(new Map([[site, { id: 'site-1' }]]));

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.true(this.submit.calledOnce);
      assert.strictEqual(organization.belongsTo('primarySite').value(), site);
      assert.deepEqual(organization.hasMany('sites').value().slice(), []);
    });

    test('it does not submit when the form is invalid', async function (assert) {
      this.controller.model.address.street = '';

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.ok(this.controller.hasValidationErrors);
      assert.true(this.submit.notCalled);
      assert.true(this.replaceWith.notCalled);
    });

    test('it shows the message of the service and keeps the records when the request is refused', async function (assert) {
      const { organization, site } = this.controller.model;
      this.submit.rejects(
        new ChangeRequestError('U mag deze organisatie niet bewerken.', {
          status: 403,
        }),
      );

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'U mag deze organisatie niet bewerken.',
      );
      assert.true(this.replaceWith.notCalled);
      assert.true(site.isNew, 'the new site is kept for a retry');
      assert.deepEqual(organization.hasMany('sites').value().slice(), [site]);

      // Leaving the page discards everything, the site added to the
      // organisation included
      this.controller.reset();

      assert.true(site.isDestroying);
      assert.deepEqual(organization.hasMany('sites').value().slice(), []);
      assert.strictEqual(this.controller.saveError, null);
    });

    test('it leaves to the list of sites with a warning when the site was created but the page could not follow it up', async function (assert) {
      this.submit.rejects(
        new ChangeRequestError(
          'De wijziging is doorgevoerd, maar het antwoord bevat geen id voor de nieuwe site.',
          { status: 201, applied: true },
        ),
      );

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.strictEqual(this.controller.saveError, null);
      assert.false(this.controller.saveBlocked);
      assert.true(
        this.warning.calledOnceWith(
          'De wijziging is doorgevoerd, maar het antwoord bevat geen id voor de nieuwe site.',
        ),
      );
      assert.true(this.refresh.calledOnce);
      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'organizations.organization.sites',
          'org-1',
        ),
        'the list of sites is opened, not the form again',
      );
    });

    test('it says why the site was not added and starts the form anew when the service holds the request', async function (assert) {
      this.controller.isPrimarySite = true;
      this.submit.rejects(
        new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
          status: 201,
          held: true,
          requestId: REQUEST_ID,
          conflicts: [
            {
              resource: { type: 'organizations', id: 'org-1' },
              key: 'primary-site',
              base: null,
              current: { type: 'sites', id: 'site-9' },
              proposed: {
                type: 'sites',
                id: '7d9e1c52-3b8a-4f0e-a6d4-2c5b9e8f1a03',
              },
              'competing-requests': [],
            },
          ],
        }),
      );
      // Refreshing the route resets this controller, as its resetController
      // does
      const revision = this.controller.formRevision;
      this.refresh.callsFake(async () => this.controller.reset());

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.true(
        this.refresh.calledOnceWithExactly(
          'organizations.organization.sites.new',
        ),
        'the form starts anew',
      );
      assert.strictEqual(
        this.controller.formRevision,
        revision + 1,
        'the form is built anew',
      );
      assert.deepEqual(this.controller.heldRequest, {
        id: REQUEST_ID,
        fields: ['Primair correspondentieadres'],
        reloadFailed: false,
        waiting: false,
      });
      assert.true(this.replaceWith.notCalled, 'the page stays');
      assert.true(this.warning.notCalled);
      assert.strictEqual(this.controller.saveError, null);
      assert.false(this.controller.saveBlocked);
    });

    test('it blocks saving and offers to apply the request again when its apply failed', async function (assert) {
      const { site } = this.controller.model;
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet doorgevoerd worden.', {
          status: 409,
          applyFailed: true,
          requestId: REQUEST_ID,
        }),
      );
      const reapply = sinon.stub(this.changeRequests, 'reapply').resolves();

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.true(this.controller.saveBlocked);
      assert.strictEqual(this.controller.failedRequestId, REQUEST_ID);
      assert.true(site.isNew, 'the records are kept');

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.true(this.submit.calledOnce, 'a second "Voeg toe" sends nothing');

      await this.controller.reapply.perform();

      assert.true(reapply.calledOnceWithExactly(REQUEST_ID));
      assert.true(this.success.calledOnce);
      assert.true(
        this.replaceWith.calledOnceWithExactly(
          'organizations.organization.sites',
          'org-1',
        ),
        'the list of sites: the uuid of the new site is not known here',
      );
    });

    test('it blocks a retry when the outcome of the request is unknown', async function (assert) {
      const { site } = this.controller.model;
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet verwerkt worden.', {
          status: 502,
        }),
      );

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'De wijziging kon niet verwerkt worden.',
      );
      assert.true(this.controller.saveBlocked);
      assert.true(this.replaceWith.notCalled);
      assert.true(site.isNew);

      await this.controller.createSiteTask.perform({ preventDefault() {} });

      assert.true(
        this.submit.calledOnce,
        'a second "Voeg toe" sends nothing: it could create the site twice',
      );
    });
  },
);
