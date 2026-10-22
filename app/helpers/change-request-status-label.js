import { helper } from '@ember/component/helper';
import { STATUS_LABELS } from 'frontend-organization-portal/constants/change-requests';

/**
 * The label of a change-request status key (`ingediend`, ...).
 */
export default helper(function changeRequestStatusLabel([status]) {
  return STATUS_LABELS[status] ?? status ?? '';
});
