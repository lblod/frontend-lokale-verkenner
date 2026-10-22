import Component from '@glimmer/component';
import {
  STATUS_LABELS,
  STATUS_SKINS,
} from 'frontend-organization-portal/constants/change-requests';

/**
 * The status of a change request as a pill.
 *
 * Arguments:
 * - `@status`: the status key of the service (`ingediend`, ...)
 */
export default class ChangeRequestsStatusComponent extends Component {
  get label() {
    return STATUS_LABELS[this.args.status] ?? this.args.status ?? '';
  }

  get skin() {
    return STATUS_SKINS[this.args.status] ?? 'default';
  }
}
