import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export default class RoleService extends Service {
  @tracked _activeRole;

  setActiveRole(role) {
    this._activeRole = role;
  }

  clearActiveRole() {
    this._activeRole = null;
  }

  get activeRole() {
    return this._activeRole;
  }
}
