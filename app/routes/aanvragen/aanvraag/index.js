import Route from '@ember/routing/route';

/**
 * A tab of the request page: it shows the request its parent loaded.
 */
export default class AanvragenAanvraagTabRoute extends Route {
  model() {
    return this.modelFor('aanvragen.aanvraag');
  }
}
