import Controller from '@ember/controller';
import { historyEntries } from 'frontend-organization-portal/utils/change-request-steps';

/**
 * Every step of the request, newest first.
 */
export default class AanvragenAanvraagGeschiedenisController extends Controller {
  get history() {
    return historyEntries(this.model).reverse();
  }
}
