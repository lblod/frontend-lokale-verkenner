import { helper } from '@ember/component/helper';
import { KIND_LABELS } from 'frontend-organization-portal/constants/change-requests';

/**
 * The label of a kind of change request (`edit`, `creation`, `change-event`).
 */
export default helper(function changeRequestKindLabel([kind]) {
  return KIND_LABELS[kind] ?? kind ?? '';
});
