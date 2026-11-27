import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module(
  'Integration | Component | change-requests/request-form',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.afterEach(function () {
      sinon.restore();
    });

    const OPERATIONS = [
      {
        op: 'update',
        data: {
          type: 'addresses',
          id: 'address-1',
          attributes: {
            street: 'Grote Markt',
            number: '3',
            postcode: '9300',
            municipality: 'Aalst',
            country: 'België',
          },
        },
      },
      {
        op: 'create',
        data: {
          type: 'contact-points',
          id: 'c1',
          attributes: {
            email: 'info@aalst.be',
            telephone: '+32 53 77 93 00',
            type: 'Primary',
          },
        },
      },
      {
        op: 'create',
        data: {
          type: 'contact-points',
          id: 'c2',
          attributes: { telephone: '+32 53 77 93 01', type: 'Secondary' },
        },
      },
      {
        op: 'update',
        data: {
          type: 'administrative-units',
          id: 'org-1',
          attributes: {
            name: 'Stad Aalst',
            'alternative-name': ['Aalst'],
            'legal-name': null,
            'expected-end-date': '2027-06-30',
          },
          relationships: {
            classification: {
              data: {
                type: 'administrative-unit-classification-codes',
                id: 'cls-1',
              },
            },
            identifiers: {
              data: [{ type: 'identifiers', lid: 'id-kbo' }],
            },
            'primary-site': { data: { type: 'sites', id: 'site-1' } },
            sites: { data: [{ type: 'sites', id: 'site-1' }] },
          },
        },
      },
      {
        op: 'create',
        data: {
          type: 'identifiers',
          lid: 'id-kbo',
          attributes: { 'id-name': 'KBO nummer' },
        },
      },
      {
        op: 'delete',
        data: {
          type: 'contact-points',
          id: 'cp-old',
          attributes: { email: 'oud@aalst.be' },
        },
      },
    ];

    test('it groups the operations into the sections of the design, read-only', async function (assert) {
      const store = this.owner.lookup('service:store');
      sinon.stub(store, 'request').resolves({
        content: { id: 'cls-1', label: 'Autonoom gemeentebedrijf' },
      });
      this.operations = OPERATIONS;

      await render(
        hbs`<ChangeRequests::RequestForm @operations={{this.operations}} />`,
      );

      const organization = '[data-test-request-form-organization]';
      assert.dom(organization).includesText('Organisatie');
      assert.dom(organization).includesText('Stad Aalst');
      assert.dom(organization).includesText('Alternatieve naam');
      assert
        .dom(organization)
        .doesNotIncludeText('Juridische naam', 'a cleared field is left out');
      assert
        .dom(organization)
        .includesText('30-06-2027', 'a date is not shown as ISO');
      assert
        .dom(organization)
        .includesText(
          'Type organisatie Autonoom gemeentebedrijf',
          'a referenced label is loaded',
        );
      assert
        .dom(organization)
        .includesText(
          'Identificatoren KBO nummer',
          'a record of the same request is named from its operation',
        );
      assert
        .dom(organization)
        .doesNotIncludeText('Vestigingen', 'sites have their own card');
      assert.dom(organization).doesNotIncludeText('Primaire contactgegevens');
      assert.dom(`${organization} input`).doesNotExist();

      const contacts = '[data-test-request-form-contacts]';
      assert.dom(contacts).includesText('Primaire contact gegevens');
      assert.dom(contacts).includesText('Grote Markt');
      assert.dom(contacts).includesText('Primair telefoonnummer');
      assert.dom(contacts).includesText('Secundair telefoonnummer');
      assert.dom(contacts).includesText('E-mail');
      assert.dom(contacts).includesText('info@aalst.be');
      assert.dom(contacts).doesNotIncludeText('Primary', 'no raw code');
      assert
        .dom(contacts)
        .doesNotIncludeText('oud@aalst.be', 'a delete is not shown');
    });

    test('it renders the Doel of an organisation as cleaned rich text, not as markup', async function (assert) {
      this.operations = [
        {
          op: 'update',
          data: {
            type: 'administrative-units',
            id: 'org-1',
            attributes: {
              purpose:
                '<p>Samenwerking rond <strong>afval</strong></p><img src=x onerror="alert(1)">',
            },
            relationships: {},
          },
        },
      ];

      await render(
        hbs`<ChangeRequests::RequestForm @operations={{this.operations}} />`,
      );

      assert.dom('[data-test-rich-text] strong').hasText('afval');
      assert.dom(this.element).doesNotIncludeText('<p>');
      assert.dom('[data-test-rich-text] img').doesNotHaveAttribute('onerror');
    });

    test('it shows no sections for a request without operations', async function (assert) {
      await render(hbs`<ChangeRequests::RequestForm />`);

      assert.dom('[data-test-request-form-organization]').doesNotExist();
      assert.dom('[data-test-request-form-contacts]').doesNotExist();
    });
  },
);
