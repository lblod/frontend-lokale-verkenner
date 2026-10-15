import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupTest } from 'frontend-organization-portal/tests/helpers';
import EditController from 'frontend-organization-portal/controllers/organizations/organization/sites/site/edit';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';
import { createSecondaryContact } from 'frontend-organization-portal/models/contact-point';

/**
 * The uuid of a change request the service kept.
 */
const REQUEST_ID = 'e78ecf96-3a00-406f-a356-30cf560d7dba';

module(
  'Unit | Controller | organizations/organization/sites/site/edit',
  function (hooks) {
    setupTest(hooks);

    // The organizations routes are built into a lazy bundle (`splitAtRoutes`
    // in ember-cli-build.js), so the controller must be registered before the
    // owner can look it up.
    hooks.beforeEach(function () {
      this.owner.register(
        'controller:organizations/organization/sites/site/edit',
        EditController,
      );
      this.store = this.owner.lookup('service:store');
      const router = this.owner.lookup('service:router');
      this.submit = sinon.stub(
        this.owner.lookup('service:change-requests'),
        'submit',
      );
      this.refresh = sinon.stub(router, 'refresh');
      this.transitionTo = sinon.stub(router, 'transitionTo');
      const toaster = this.owner.lookup('service:toaster');
      this.warning = sinon.stub(toaster, 'warning');
      this.success = sinon.stub(toaster, 'success');
      this.controller = this.owner.lookup(
        'controller:organizations/organization/sites/site/edit',
      );
      this.controller.model = this.siteModel();
      this.controller.setup();
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    /**
     * The model of the route for the primary site of an organisation, with
     * its address and primary contact point, plus the new secondary contact
     * point the route creates when the site has none.
     */
    this.siteModel = function () {
      const [organization, site, address, contact] = this.store.push({
        data: [
          {
            type: 'organization',
            id: 'org-1',
            attributes: { name: 'Gemeente Test' },
            relationships: {
              primarySite: { data: { type: 'site', id: 'site-1' } },
              sites: { data: [] },
            },
          },
          {
            type: 'site',
            id: 'site-1',
            attributes: {},
            relationships: {
              address: { data: { type: 'address', id: 'address-1' } },
              contacts: { data: [{ type: 'contact-point', id: 'contact-1' }] },
              siteType: { data: { type: 'site-type', id: 'site-type-1' } },
            },
          },
          {
            type: 'address',
            id: 'address-1',
            attributes: {
              street: 'Kerkstraat',
              number: '1',
              postcode: '9000',
              municipality: 'Gent',
              province: 'Oost-Vlaanderen',
              country: 'België',
              fullAddress: 'Kerkstraat 1, 9000 Gent, België',
            },
          },
          {
            type: 'contact-point',
            id: 'contact-1',
            attributes: {
              email: 'info@gent.be',
              telephone: '+3290000000',
              type: 'Primary',
            },
          },
          {
            type: 'site-type',
            id: 'site-type-1',
            attributes: { label: 'Hoofdzetel' },
          },
        ],
      });

      return {
        site,
        address,
        contact,
        secondaryContact: createSecondaryContact(this.store),
        organization,
        currentPrimarySite: site,
      };
    };

    test('it submits the changed address and contact points with the site and opens the site', async function (assert) {
      const { site, address, contact, secondaryContact } =
        this.controller.model;
      address.street = 'Markt';
      contact.email = 'post@gent.be';
      this.submit.resolves(new Map());

      await this.controller.save.perform({ preventDefault() {} });

      assert.notOk(this.controller.hasValidationErrors);
      assert.true(this.submit.calledOnce);
      const [aggregate, target, records] = this.submit.firstCall.args;
      assert.strictEqual(aggregate, 'site');
      assert.strictEqual(target, 'org-1');
      assert.deepEqual(
        records,
        [address, contact, site],
        'the primary site stays primary, so the organisation stays out, and so does the secondary contact point the user left empty',
      );
      assert.deepEqual(site.hasMany('contacts').ids(), ['contact-1']);
      assert.true(secondaryContact.isNew);
      assert.strictEqual(address.fullAddress, 'Markt 1, 9000 Gent, België');
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.sites.site',
          'site-1',
        ),
      );
    });

    test('it submits and links the secondary contact point the route created once the user filled it in', async function (assert) {
      const { site, contact, secondaryContact } = this.controller.model;
      secondaryContact.telephone = '+3253779300';
      this.submit.resolves(new Map());

      await this.controller.save.perform({ preventDefault() {} });

      assert.deepEqual(this.submit.firstCall.args[2], [secondaryContact, site]);
      assert.deepEqual(site.hasMany('contacts').value().slice(), [
        contact,
        secondaryContact,
      ]);
    });

    test('it names the fields someone else changed and rebuilds the form when the service holds the request', async function (assert) {
      const { address, contact } = this.controller.model;
      address.street = 'Markt';
      contact.telephone = '+3291111111';
      this.submit.rejects(
        new ChangeRequestError('De wijziging werd niet doorgevoerd.', {
          status: 201,
          held: true,
          requestId: REQUEST_ID,
          conflicts: [
            {
              resource: { type: 'addresses', id: 'address-1' },
              key: 'street',
              base: 'Kerkstraat',
              current: 'Kerkplein',
              proposed: 'Markt',
              'competing-requests': [],
            },
            {
              resource: { type: 'addresses', id: 'address-1' },
              key: 'full-address',
              base: 'Kerkstraat 1, 9000 Gent, België',
              current: 'Kerkplein 1, 9000 Gent, België',
              proposed: 'Markt 1, 9000 Gent, België',
              'competing-requests': [],
            },
            {
              resource: { type: 'contact-points', id: 'contact-1' },
              key: 'telephone',
              base: 'tel:+3290000000',
              current: 'tel:+3292222222',
              proposed: 'tel:+3291111111',
              'competing-requests': [],
            },
            {
              resource: { type: 'sites', id: 'site-1' },
              key: 'contacts',
              base: [{ type: 'contact-points', id: 'contact-1' }],
              current: [],
              proposed: [
                { type: 'contact-points', id: 'contact-1' },
                {
                  type: 'contact-points',
                  id: '5f0c2a8e-9d41-4b6a-8e3f-1a7c6d2b9e54',
                },
              ],
              'competing-requests': [],
            },
          ],
        }),
      );
      // Refreshing the route resets this controller, as the edit route's
      // resetController does
      const revision = this.controller.formRevision;
      this.refresh.callsFake(async () => {
        this.controller.reset();
        assert.strictEqual(this.controller.formRevision, revision);
      });

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(
        this.refresh.calledOnceWithExactly(
          'organizations.organization.sites.site',
        ),
        'the route that loads the site with its address and contact points is refreshed',
      );
      assert.strictEqual(
        this.controller.formRevision,
        revision + 1,
        'the form is built anew from the reloaded records',
      );
      assert.deepEqual(
        this.controller.heldRequest,
        {
          id: REQUEST_ID,
          fields: [
            'Straat',
            'Adres',
            'Primair telefoonnummer',
            'Contactgegevens',
          ],
          reloadFailed: false,
        },
        'the request and the labels of the page, each once',
      );
      assert.true(this.transitionTo.notCalled, 'the page stays');
      assert.true(this.warning.notCalled);
      assert.strictEqual(this.controller.saveError, null);
      assert.false(this.controller.saveBlocked);

      // Leaving the page clears the notice
      this.controller.reset();

      assert.strictEqual(this.controller.heldRequest, null);
    });

    test('it blocks saving and offers to apply the request again when its apply failed', async function (assert) {
      const { address, site } = this.controller.model;
      address.street = 'Markt';
      this.submit.rejects(
        new ChangeRequestError('De wijziging kon niet doorgevoerd worden.', {
          status: 409,
          applyFailed: true,
          requestId: REQUEST_ID,
        }),
      );
      const reapply = sinon
        .stub(this.owner.lookup('service:change-requests'), 'reapply')
        .resolves();

      await this.controller.save.perform({ preventDefault() {} });

      assert.true(this.controller.saveBlocked);
      assert.strictEqual(this.controller.failedRequestId, REQUEST_ID);
      assert.strictEqual(address.street, 'Markt', 'the edits are kept');

      await this.controller.reapply.perform();

      assert.true(reapply.calledOnceWithExactly(REQUEST_ID));
      assert.true(this.success.calledOnce);
      assert.true(
        this.transitionTo.calledOnceWithExactly(
          'organizations.organization.sites.site',
          site.id,
        ),
      );
    });

    test('it shows the message of the service and keeps the edits when the request is refused', async function (assert) {
      const { address } = this.controller.model;
      address.street = 'Markt';
      this.submit.rejects(
        new ChangeRequestError('U mag deze organisatie niet bewerken.', {
          status: 403,
        }),
      );

      await this.controller.save.perform({ preventDefault() {} });

      assert.strictEqual(
        this.controller.saveError,
        'U mag deze organisatie niet bewerken.',
      );
      assert.strictEqual(this.controller.heldRequest, null);
      assert.true(this.refresh.notCalled);
      assert.true(this.transitionTo.notCalled);
      assert.strictEqual(address.street, 'Markt');
    });
  },
);
