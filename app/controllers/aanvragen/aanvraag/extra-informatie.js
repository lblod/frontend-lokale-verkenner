import Controller from '@ember/controller';
import { CONVERSATION_STEPS } from 'frontend-organization-portal/constants/change-requests';
import { stepsWithActors } from 'frontend-organization-portal/utils/change-request-steps';

/**
 * The exchange between ABB and the requester: the questions, answers,
 * rejections and contests, in order.
 */
export default class AanvragenAanvraagExtraInformatieController extends Controller {
  get conversation() {
    return stepsWithActors(this.model).filter(({ step }) =>
      CONVERSATION_STEPS.includes(step.type),
    );
  }
}
