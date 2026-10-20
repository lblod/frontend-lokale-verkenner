import Model, { attr, hasMany } from '@warp-drive/legacy/model';

export default class UserModel extends Model {
  @attr firstName;
  @attr familyName;

  @hasMany('account', {
    inverse: 'user',
    async: false,
  })
  accounts;

  @hasMany('organization', {
    polymorphic: true,
    inverse: null,
    async: false,
  })
  organizations;

  get group() {
    return this.organizations.at(0);
  }

  get fullName() {
    return `${this.firstName} ${this.familyName}`.trim();
  }
}
