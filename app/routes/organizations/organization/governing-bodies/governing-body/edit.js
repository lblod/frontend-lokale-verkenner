import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class OrganizationsOrganizationGoverningBodiesGoverningBodyEditRoute extends Route {
  @service router;

  beforeModel() {
    // Bestuursorganen are mastered by LMB and read-only here: this page is
    // not switched to change requests and its saves would be refused by the
    // backend. Nothing links to it; it never opens.
    this.router.transitionTo('unauthorized');
  }

  async model() {
    const { organization, governingBodyClassification, governingBody } =
      await this.modelFor(
        'organizations.organization.governing-bodies.governing-body',
      );

    return {
      governingBody,
      governingBodyClassification,
      organization,
    };
  }

  resetController(controller) {
    super.resetController(...arguments);
    controller.reset();
  }
}
