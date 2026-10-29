import { helper } from '@ember/component/helper';
import { stepLabel } from 'frontend-organization-portal/constants/change-requests';

/**
 * What the history of a change request shows for a step type, with the
 * status the step ended in: an apply that failed says so.
 */
export default helper(function changeRequestStepLabel([stepType, status]) {
  return stepLabel(stepType, status);
});
