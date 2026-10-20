import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';

const DEBOUNCE_MS = 250;
const PAGE_SIZE = 10;

export default class MockLoginController extends Controller {
  queryParams = ['page', 'organisatie'];
  @tracked page = 0;
  @tracked organisatie = '';

  get size() {
    return PAGE_SIZE;
  }

  updateSearchTask = restartableTask(async (value) => {
    await timeout(DEBOUNCE_MS);
    this.organisatie = value;
    this.page = 0;
  });

  @action
  updateSearch(event) {
    this.updateSearchTask.perform(event.target.value);
  }
}
