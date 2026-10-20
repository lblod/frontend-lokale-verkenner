import { helper } from '@ember/component/helper';
import { STEP_LABELS } from 'frontend-organization-portal/constants/change-requests';

/**
 * What the history of a change request shows for a step type.
 */
export default helper(function changeRequestStepLabel([stepType]) {
  return STEP_LABELS[stepType] ?? stepType ?? '';
});
