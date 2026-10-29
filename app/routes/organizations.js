import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class OrganizationsRoute extends Route {
  @service session;
  @service router;
  @service role;
  @service changeRequests;

  async beforeModel(transition) {
    this.session.requireAuthentication(transition, 'login');

    if (!this.role.activeRole) {
      return this.router.transitionTo('index');
    }

    // Whether the session may request a new organisation decides whether the
    // overview offers "Nieuw"
    await this.changeRequests.loadRights();
  }
}
