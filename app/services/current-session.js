import Service, { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import { tracked } from '@glimmer/tracking';

const EDITOR_ROLES = [
  'ABBOrganisatiePortaalGebruiker-editeerder',
  'ABBOrganisatiePortaalErediensten-editeerder',
  'ABBOrganisatiePortaalGebruiker-beheerder',
  'ABBOrganisatiePortaalErediensten-beheerder',
];

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

const READER_ROLES = [
  'ABBOrganisatiePortaalErediensten-lezer',
  'ABBOrganisatiePortaalGebruiker-lezer',
];

export default class CurrentSessionService extends Service {
  @service session;
  @service store;
  @service role;

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
  get hasWorshipRole() {
    return WORSHIP_ROLES.includes(this.role.activeRole);
  }

  get hasUnitRole() {
    return UNIT_ROLES.includes(this.role.activeRole);
  }

  get canEdit() {
    return EDITOR_ROLES.includes(this.role.activeRole);
  }

  get canOnlyRead() {
    return READER_ROLES.includes(this.role.activeRole);
  }
}
