import Controller from '@ember/controller';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import {
  KIND_LABELS,
  LISTED_KINDS,
  STATUS,
  STATUS_LABELS,
} from 'frontend-organization-portal/constants/change-requests';
import { CLASSIFICATION } from 'frontend-organization-portal/models/administrative-unit-classification-code';

/**
 * The classification of Agentschap Binnenlands Bestuur, which requests
 * organisations and change events itself.
 */
export const ABB_CLASSIFICATION_ID = '52cc9d8d-1c9a-4d92-9936-da9d4a622ec4';

/**
 * The classifications of the organisations a request can be about, for the
 * "Naam betrokken organisatie" filter: every type the register knows.
 */
const TARGET_CLASSIFICATION_IDS = Object.values(CLASSIFICATION).map(
  ({ id }) => id,
);

/**
 * The classifications of the organisations that request, for the
 * "Aanvrager" filter: those of the register and ABB's own.
 */
const REQUESTER_CLASSIFICATION_IDS = [
  ...TARGET_CLASSIFICATION_IDS,
  ABB_CLASSIFICATION_ID,
];

const toOptions = (labels, keys) =>
  keys.map((key) => ({ key, label: labels[key] }));

/**
 * The filters of the list of change requests, as query parameters: the kind,
 * only mine, the requesting organisation, the organisation the request is
 * about and its classification, the status, and the period it was submitted
 * in. Oldest first by default.
 */
export default class AanvragenIndexController extends Controller {
  @service router;
  @service store;

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

  /**
   * The kinds the list holds: edits are history only.
   */
  kindOptions = toOptions(KIND_LABELS, LISTED_KINDS);

  /**
   * Every status a request lasts in: `goedgekeurd` is followed by the
   * afhandeling in the same update.
   */
  statusOptions = toOptions(
    STATUS_LABELS,
    Object.values(STATUS).filter((status) => status !== STATUS.APPROVED),
  );

  requesterClassificationCodes = REQUESTER_CLASSIFICATION_IDS;
  targetClassificationCodes = TARGET_CLASSIFICATION_IDS;

  /**
   * The records the filters name, by `modelName:id`, for their selects to
   * show: the query parameters carry the uuids. A record the user picks is
   * kept as picked; one the URL names is loaded (`loadSelectedRecords`).
   * Replaced, never mutated.
   */
  @tracked selectedRecords = new Map();

  get selectedRequester() {
    return this.selectedRecord('organization', this.requester);
  }

  get selectedOrganization() {
    return this.selectedRecord('organization', this.organization);
  }

  get selectedClassification() {
    return this.selectedRecord(
      'organization-classification-code',
      this.targetClassification,
    );
  }

  selectedRecord(modelName, id) {
    return (id && this.selectedRecords.get(`${modelName}:${id}`)) || null;
  }

  keepSelected(modelName, record) {
    if (record) {
      this.selectedRecords = new Map(this.selectedRecords).set(
        `${modelName}:${record.id}`,
        record,
      );
    }
  }

  /**
   * Load the records the filters name that the page does not have yet, such
   * as those of a link or a reload. One that cannot be loaded leaves its
   * select empty; the list is filtered all the same.
   */
  loadSelectedRecords = restartableTask(async () => {
    const wanted = [
      ['organization', this.requester],
      ['organization', this.organization],
      ['organization-classification-code', this.targetClassification],
    ].filter(
      ([modelName, id]) =>
        id && !this.selectedRecords.has(`${modelName}:${id}`),
    );
    const loaded = await Promise.all(
      wanted.map(async ([modelName, id]) => {
        try {
          const { content } = await this.store.request(
            findRecord(modelName, id),
          );
          return [modelName, content];
        } catch {
          return null;
        }
      }),
    );
    for (const entry of loaded.filter(Boolean)) {
      this.keepSelected(...entry);
    }
  });

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
    this.keepSelected('organization', organization);
    this.requester = organization?.id ?? '';
  }

  @action
  setOrganization(organization) {
    this.page = null;
    this.keepSelected('organization', organization);
    this.organization = organization?.id ?? '';
  }

  @action
  setTargetClassification(classification) {
    this.page = null;
    this.keepSelected('organization-classification-code', classification);
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
 * A date as the `YYYY-MM-DD` the query parameters carry, or '' for none. The
 * date picker gives the picked day as midnight UTC (`new Date('YYYY-MM-DD')`),
 * which is the evening before in a browser west of UTC: a date at midnight
 * UTC is read in UTC, any other one in local time.
 */
export function toDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const inUtc =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  const pad = (number) => String(number).padStart(2, '0');
  const [year, month, day] = inUtc
    ? [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]
    : [date.getFullYear(), date.getMonth(), date.getDate()];
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
