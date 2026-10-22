import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { query } from '@warp-drive/legacy/compat/builders';

export default class MockLoginRoute extends Route {
  @service session;
  @service store;

  queryParams = {
    page: {
      refreshModel: true,
    },
    organisatie: {
      refreshModel: true,
    },
  };

  beforeModel() {
    this.session.prohibitAuthentication('index');
  }

  async model(params) {
    let filter = {
      provider: 'https://github.com/lblod/mock-login-service',
    };
    // The organisation data is for logged-in sessions: an account is found
    // by its person, whose names are the classification and the name of the
    // organisation (see the migration that adds the mock accounts)
    if (params.organisatie) {
      filter.user = params.organisatie;
    }

    let { content: accounts } = await this.store.request(
      query('account', {
        include: 'user.organizations',
        filter,
        page: { size: 10, number: params.page },
        sort: 'user.family-name',
      }),
    );

    return { accounts };
  }
}
