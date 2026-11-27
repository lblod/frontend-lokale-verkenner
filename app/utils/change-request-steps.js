import { CONVERSATION_STEPS } from 'frontend-organization-portal/constants/change-requests';

/** How much of a step's text the history cell shows before the tooltip. */
const SHORT_DETAILS_LENGTH = 60;

/**
 * The steps of a request as the history table shows them: the step itself
 * and its text. A step whose text the service kept from the viewer gets the
 * note that says so. `shortDetails` is the text cut for the cell; `truncated`
 * tells whether the full text is longer and belongs in the tooltip.
 *
 * @param {Object} model - the model of the request page: `request`
 * @returns {Array<{ step: Object, details: string, shortDetails: string, truncated: boolean }>}
 */
export function historyEntries({ request }) {
  const steps = request?.attributes?.steps ?? [];
  return steps.map((step) => {
    const details =
      step.reason ||
      step.error ||
      (CONVERSATION_STEPS.includes(step.type)
        ? 'Enkel zichtbaar voor de aanvrager en ABB'
        : '');
    return {
      step,
      details,
      shortDetails: shorten(details),
      truncated: details.length > SHORT_DETAILS_LENGTH,
    };
  });
}

function shorten(text) {
  return text.length > SHORT_DETAILS_LENGTH
    ? `${text.slice(0, SHORT_DETAILS_LENGTH).trimEnd()}…`
    : text;
}
