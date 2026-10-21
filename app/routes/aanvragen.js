import Route from '@ember/routing/route';
import { service } from '@ember/service';

/**
 * The change requests: the list and the detail pages. Logged-in users only,
 * like the organisations.
 */
export default class AanvragenRoute extends Route {
  @service session;
  @service router;
  @service role;
  @service changeRequests;

  beforeModel(transition) {
    // A visitor who is not logged in goes to the login page, which
    // `requireAuthentication` started a transition to
    if (!this.session.requireAuthentication(transition, 'login')) {
      return;
    }

    if (!this.role.activeRole) {
      return this.router.transitionTo('index');
    }
  }

  /**
   * What the session may do with requests in general: decide on them (ABB),
   * and which organisations it may request.
   */
  model() {
    return this.changeRequests.loadRights();
  }
}
