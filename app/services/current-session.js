import Service, { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import { tracked } from '@glimmer/tracking';

const WORSHIP_ROLES = [
  'ABBOrganisatiePortaalErediensten-beheerder',
  'ABBOrganisatiePortaalErediensten-editeerder',
  'ABBOrganisatiePortaalErediensten-lezer',
];

const UNIT_ROLES = [
  'ABBOrganisatiePortaalGebruiker-editeerder',
  'ABBOrganisatiePortaalGebruiker-beheerder',
  'ABBOrganisatiePortaalGebruiker-lezer',
];

export default class CurrentSessionService extends Service {
  @service session;
  @service store;
  @service role;
  @service changeRequests;

  @tracked account;
  @tracked user;
  @tracked group;
  @tracked groupClassification;
  @tracked roles;

  async load() {
    if (this.session.isAuthenticated) {
      let sessionData = this.session.data.authenticated.relationships;
      let accountId = sessionData.account.data.id;

      const { content: account } = await this.store.request(
        findRecord('account', accountId, {
          include: 'user',
        }),
      );
      this.account = account;
      this.user = this.account.user;
      let accountRoles = this.account.roles;
      if (!Array.isArray(accountRoles)) {
        accountRoles = [];
      }
      let uniqueRoles = new Set(accountRoles);
      this.roles = [...uniqueRoles];
      // The active role is the account's first one. Set here, it holds for
      // the boot of the app and for a login in a running app alike; the
      // routes send a session without one back to index.
      this.role.setActiveRole(this.roles[0] ?? null);

      // The group is not defined for acm idm logins, so only resolve it when
      // the session data provides one (e.g. mock login).
      let groupId = sessionData?.group?.data?.id;
      if (groupId) {
        const { content: group } = await this.store.request(
          findRecord('organization', groupId, {
            include: 'classification',
            reload: true,
          }),
        );
        this.group = group;
        this.groupClassification = await this.group.classification;
      }
    }
  }

  /**
   * The uuid of the organisation the session acts for. The login service
   * links the session to the organisation the user logged in for
   * (`ext:sessionGroup`), which the session document carries as its `group`
   * relationship (the `groups` resource in config/resources/auth.json of the
   * backend). The change-request service decides from that same session which
   * organisations may be edited, so the frontend only asks it, see
   * `canEdit`.
   */
  get organizationId() {
    return this.session.data?.authenticated?.relationships?.group?.data?.id;
  }

  /**
   * The organisation the session acts for (the session's group, loaded in `load`).
   */
  get organization() {
    return this.group;
  }

  get hasWorshipRole() {
    return WORSHIP_ROLES.includes(this.role.activeRole);
  }

  get hasUnitRole() {
    return UNIT_ROLES.includes(this.role.activeRole);
  }

  /**
   * Whether the session may edit the organisation whose pages are open. The
   * answer comes from the change-request service and is loaded by the
   * organisation route, which also says which organisation is open, so it is
   * false outside the organisation pages and during a transition into one
   * (the edit-route guards ask `changeRequests.canEditOrganization` for the
   * organisation of their transition instead).
   */
  get canEdit() {
    return this.changeRequests.canEdit;
  }

  get canOnlyRead() {
    return !this.canEdit;
  }
}
