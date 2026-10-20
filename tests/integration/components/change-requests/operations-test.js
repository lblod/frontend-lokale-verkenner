import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupRenderingTest } from 'frontend-organization-portal/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

module(
  'Integration | Component | change-requests/operations',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('it shows one card per record with the fields the request proposes, naming the records the request creates and loading the others', async function (assert) {
      const store = this.owner.lookup('service:store');
      // The findRecord builder names the record under data.record
      sinon.stub(store, 'request').callsFake(async ({ data }) => {
        assert.step(
          `load ${data?.record?.type ?? '?'} ${data?.record?.id ?? '?'}`,
        );
        return {
          content: { id: data?.record?.id, label: 'Autonoom gemeentebedrijf' },
        };
      });
      this.operations = [
        {
          op: 'create',
          data: {
            type: 'administrative-units',
            id: 'org-new',
            attributes: {
              name: 'AGB Aalst',
              'legal-name': null,
              'alternative-name': ['AGB'],
              'expected-end-date': '2030-12-31',
            },
            relationships: {
              classification: {
                data: {
                  type: 'administrative-unit-classification-codes',
                  id: 'cls-agb',
                },
              },
              identifiers: {
                data: [{ type: 'identifiers', id: 'id-kbo' }],
              },
              'primary-site': { data: null },
            },
          },
        },
        {
          op: 'create',
          data: {
            type: 'identifiers',
            id: 'id-kbo',
            attributes: { 'id-name': 'KBO nummer' },
            relationships: {},
          },
        },
        { op: 'delete', data: { type: 'contact-points', id: 'cp-1' } },
      ];

      await render(
        hbs`<ChangeRequests::Operations @operations={{this.operations}} />`,
      );

      assert.dom('[data-test-operation]').exists({ count: 3 });
      const organisation = '[data-test-operation="administrative-units"]';
      assert.dom(`${organisation} h3`).includesText('Organisatie');
      assert.dom(`${organisation} .au-c-pill`).hasText('Nieuw');
      assert.dom(`${organisation} dl`).includesText('Naam AGB Aalst');
      assert.dom(`${organisation} dl`).includesText('Juridische naam Geen');
      assert.dom(`${organisation} dl`).includesText('Alternatieve naam AGB');
      assert
        .dom(`${organisation} dl`)
        .includesText('Geplande einddatum 31-12-2030');
      assert
        .dom(`${organisation} dl`)
        .includesText(
          'Type organisatie Autonoom gemeentebedrijf',
          'a code list value is loaded',
        );
      assert
        .dom(`${organisation} dl`)
        .includesText(
          'Identificatoren KBO nummer',
          'a record of the same request is named from its operation',
        );
      assert
        .dom(`${organisation} dl`)
        .includesText('Primaire contactgegevens Geen');
      assert.verifySteps(
        ['load administrative-unit-classification-code cls-agb'],
        'only the classification is fetched, under the model of its type; the identifier is in the request',
      );
      assert
        .dom('[data-test-operation="contact-points"] .au-c-pill')
        .hasText('Verwijderd');
      assert
        .dom('[data-test-operation="contact-points"]')
        .includesText('De gegevens van dit record worden verwijderd.');
    });

    test('it says so when the request carries no operations', async function (assert) {
      this.operations = [];

      await render(
        hbs`<ChangeRequests::Operations @operations={{this.operations}} />`,
      );

      assert
        .dom(this.element)
        .includesText('Deze aanvraag bevat geen gegevens.');
    });
  },
);
