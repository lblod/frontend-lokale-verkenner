import Controller from '@ember/controller';
import { stepsWithActors } from 'frontend-organization-portal/utils/change-request-steps';

/**
 * Every step of the request, oldest first, with who took it.
 */
export default class AanvragenAanvraagGeschiedenisController extends Controller {
  get history() {
    return stepsWithActors(this.model);
  }
}
