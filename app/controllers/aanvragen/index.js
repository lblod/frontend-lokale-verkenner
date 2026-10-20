import Controller from '@ember/controller';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import {
  KIND_LABELS,
  STATUS_LABELS,
} from 'frontend-organization-portal/constants/change-requests';

const toOptions = (labels) =>
  Object.entries(labels).map(([key, label]) => ({ key, label }));

/**
 * The filters of the list of change requests, as query parameters: the kind,
 * only mine, the requesting organisation, the organisation the request is
 * about and its classification, the status, and the period it was submitted
 * in. Oldest first by default.
 */
export default class AanvragenIndexController extends Controller {
  @service router;

  queryParams = [
    'page',
    'size',
    'sort',
    'kind',
    'mine',
    'requester',
    'organization',
    'targetClassification',
    'status',
    'createdFrom',
    'createdUntil',
  ];

  @tracked page = 0;
  size = 20;
  @tracked sort = 'created';
  @tracked kind = '';
  @tracked mine = false;
  @tracked requester = '';
  /**
   * The organisation the requests are about. Not named `target`: that is a
   * property of every Ember controller (the router actions go there).
   */
  @tracked organization = '';
  @tracked targetClassification = '';
  @tracked status = '';
  @tracked createdFrom = '';
  @tracked createdUntil = '';

  kindOptions = toOptions(KIND_LABELS);
  statusOptions = toOptions(STATUS_LABELS);

  get selectedKind() {
    return this.kindOptions.find((option) => option.key === this.kind) ?? null;
  }

  get selectedStatus() {
    return (
      this.statusOptions.find((option) => option.key === this.status) ?? null
    );
  }

  get requests() {
    return this.model.loadRequestsTaskInstance.isFinished
      ? this.model.loadRequestsTaskInstance.value
      : this.model.loadedRequests;
  }

  get isLoading() {
    return this.model.loadRequestsTaskInstance.isRunning;
  }

  get hasPreviousData() {
    return this.model.loadedRequests && this.model.loadedRequests.length > 0;
  }

  get showTableLoader() {
    return this.isLoading && !this.hasPreviousData;
  }

  get hasNoResults() {
    return (
      this.model.loadRequestsTaskInstance.isFinished &&
      this.requests.length === 0
    );
  }

  get hasErrored() {
    return this.model.loadRequestsTaskInstance.isError;
  }

  get hasFilters() {
    return Boolean(
      this.kind ||
      this.mine ||
      this.requester ||
      this.organization ||
      this.targetClassification ||
      this.status ||
      this.createdFrom ||
      this.createdUntil,
    );
  }

  @action
  setKind(option) {
    this.page = null;
    this.kind = option?.key ?? '';
  }

  @action
  toggleMine() {
    this.page = null;
    this.mine = !this.mine;
  }

  @action
  setRequester(organization) {
    this.page = null;
    this.requester = organization?.id ?? '';
  }

  @action
  setOrganization(organization) {
    this.page = null;
    this.organization = organization?.id ?? '';
  }

  @action
  setTargetClassification(classification) {
    this.page = null;
    this.targetClassification = classification?.id ?? '';
  }

  @action
  setStatus(option) {
    this.page = null;
    this.status = option?.key ?? '';
  }

  @action
  setCreatedFrom(date) {
    this.page = null;
    this.createdFrom = toDay(date);
  }

  @action
  setCreatedUntil(date) {
    this.page = null;
    this.createdUntil = toDay(date);
  }

  @action
  resetFilters() {
    this.page = null;
    this.kind = '';
    this.mine = false;
    this.requester = '';
    this.organization = '';
    this.targetClassification = '';
    this.status = '';
    this.createdFrom = '';
    this.createdUntil = '';
  }
}

/**
 * A date as the `YYYY-MM-DD` the query parameters carry, or '' for none.
 */
export function toDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
