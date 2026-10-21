import Route from '@ember/routing/route';
import { service } from '@ember/service';

/**
 * The entry from Loket: `/mijn-organisatie` lands the user on the
 * kerngegevens of the organisation they are logged in for, without Loket
 * having to know its id.
 */
export default class MijnOrganisatieRoute extends Route {
  @service session;
  @service router;
  @service currentSession;

  beforeModel(transition) {
    // A visitor who is not logged in goes to the login page, which
    // `requireAuthentication` started a transition to
    if (!this.session.requireAuthentication(transition, 'login')) {
      return;
    }

    const { organizationId } = this.currentSession;
    if (organizationId) {
      this.router.replaceWith(
        'organizations.organization.core-data',
        organizationId,
      );
    } else {
      this.router.replaceWith('unauthorized');
    }
  }
}
