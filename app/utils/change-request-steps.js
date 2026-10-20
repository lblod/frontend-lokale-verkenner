import { CONVERSATION_STEPS } from 'frontend-organization-portal/constants/change-requests';

/**
 * The steps of a request with who took each one, as the pages show them:
 * the requesting organisation by name, ABB, or the service ("automatisch").
 * The service shows the person who took a step to the requesting
 * organisation and ABB only, and never names one on these pages: the
 * organisation is what matters.
 *
 * @param {Object} model - the model of the request page: `request`,
 *     `requesterId`, `requester`
 * @returns {Array<{ step: Object, actor: string, hiddenText: boolean }>}
 *     `hiddenText` is set for a step whose text the service kept from the
 *     viewer
 */
export function stepsWithActors({ request, requesterId, requester }) {
  const steps = request?.attributes?.steps ?? [];
  const requesterName = requester?.abbName ?? requester?.name ?? 'de aanvrager';
  return steps.map((step) => ({
    step,
    actor: actorOf(step, requesterId, requesterName),
    hiddenText:
      CONVERSATION_STEPS.includes(step.type) && !step.reason && !step.error,
  }));
}

function actorOf(step, requesterId, requesterName) {
  if (step.agent === 'service') {
    return 'Automatisch';
  }
  if (step.organisation && step.organisation === requesterId) {
    return requesterName;
  }
  return 'ABB';
}
