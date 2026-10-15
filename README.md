# frontend-organization-portal

This ember application provides endpoints to visualize linked data exposed by the Contact Hub Backend.

## Prerequisites

You will need the following things properly installed on your computer.

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) (with npm)
- [Ember CLI](https://cli.emberjs.com/release/)
- [Google Chrome](https://google.com/chrome/)

## Installation

- `git clone <repository-url>` this repository
- `cd frontend-organization-portal`
- `npm install`

## Running / Development

- `npm run start`
- Visit your app at [http://localhost:4200](http://localhost:4200).
- Visit your tests at [http://localhost:4200/tests](http://localhost:4200/tests).

### Code Generators

Make use of the many generators for code, try `ember help generate` for more details

### Running Tests

- `npm run test`
- `npm run test:ember -- --server`

### Linting

- `npm run lint`
- `npm run lint:fix`

### Building

- `npm exec ember build` (development)
- `npm run build` (production)

### Deploying

Specify what it takes to deploy your app.

## Further Reading / Useful Links

- [ember.js](https://emberjs.com/)
- [ember-cli](https://cli.emberjs.com/release/)
- Development Browser Extensions
  - [ember inspector for chrome](https://chrome.google.com/webstore/detail/ember-inspector/bmdblncegkenkacieihfhpjfppoconhi)
  - [ember inspector for firefox](https://addons.mozilla.org/en-US/firefox/addon/ember-inspector/)

## Docker

Build the image: docker build -t lblod/frontend-organization-portal -f Dockerfile.fastboot .

## Reference

### Feature flags

Feature flags are used to enable/disable features in the application. They are defined in [config/environment.js](config/environment.js).

```javascript
// in config/environment.js
let ENV = {
  // Other configuration settings...
  features: {
    "new-feature": true, // Enable the 'new-feature' by default
    "beta-feature": false, // Disable the 'beta-feature' by default
  },
};
```

The configuration can be manually overridden by adding a query parameter to the URL:

- `?feature-new-feature=false` to disable the 'new-feature'
- `?feature-beta-feature=true` to enable the 'beta-feature'

The overriding will be saved in a cookie, so it will persist across page reloads. The cookie can be cleared by adding `?clear-feature-overrides=true` to the URL.

The feature flags can be used in the application by injecting the `features` service and calling the `isEnabled` method.

```javascript
import { service } from "@ember/service";

export default class ExampleComponent extends Component {
  @service features;

  doSomething() {
    if (this.features.isEnabled("new-feature")) {
      // Implement the logic for the new feature
      console.log("New feature is enabled!");
    } else {
      // Implement the logic for the default behavior without the new feature
      console.log("New feature is disabled!");
    }
  }
}
```

Or in template files by using the `is-feature-enabled` helper:

```handlebars
{{#if (is-feature-enabled "new-feature")}}
  <p>New feature is enabled!</p>
{{else}}
  <p>New feature is disabled!</p>
{{/if}}
```

### List of feature flags

| Name              | Description                        |
| ----------------- | ---------------------------------- |
| edit-contact-data | Enable the edition of contact site |

## Change requests

Every edit this application makes to an organisation is a change request,
sent to the change-request service of the backend (`/change-requests`), which
checks who may edit what, keeps the request with the proposed state as its
history and applies it to the organisation data. In the first iteration every
request is applied immediately. The resource routes are read-only for this
application: the backend refuses a write on them, and the pages that still
contain such a write (see the table) are closed.

### Which pages edit

| Page                                                                           | Status                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Kerngegevens (`core-data/edit`)                                                | change request, aggregate `organization-core-data`                                                       |
| Vestigingen (`sites/new`, `sites/site/edit`)                                   | change request, aggregate `site`                                                                         |
| Veranderingsgebeurtenissen (`change-events/new`, `change-events/details/edit`) | not switched yet: the edit routes redirect to `unauthorized` and the pages show no edit action           |
| Gerelateerde organisaties (`related-organizations/edit`)                       | not switched yet: idem                                                                                   |
| Betrokken lokale besturen (`local-involvements/edit`, worship)                 | not switched yet: idem                                                                                   |
| Bestuursorganen (`governing-bodies/governing-body/edit`)                       | read-only, mastered by LMB: the edit route redirects and the page shows no edit action                   |
| Nieuwe organisatie (`organizations/new`)                                       | hidden: the route redirects, nothing links to it                                                         |
| Nieuwe positie (`people/new-position`)                                         | a static notice without a save; its guard reads `canEdit`, which is false outside the organisation pages |

A page is switched by replacing its chain of `saveRecord` calls with one
`submit` and by handling `ChangeRequestError` as the switched pages do.

### The `change-requests` service

`app/services/change-requests.js`:

- `submit(aggregate, target, records)` posts the proposed state of one
  aggregate. `target` is the uuid of the organisation the request is about,
  `records` the Ember Data records of the aggregate, dependencies first (the
  address and contact points before the site, the site before the organisation
  that links it). Every record is serialised with the JSON:API serializer of
  the store, so the service receives the same types, attributes and
  relationships that mu-cl-resources would get. A new record gets a `lid`, a
  UUID generated in the browser, and other records reference it by that `lid`
  instead of an `id`. A new record that is referenced by a to-one relationship
  must be part of the request (`submit` throws otherwise); a new record in a
  to-many relationship that is not part of the request is left out, as the
  serializer leaves out every new record (the kerngegevens page keeps
  placeholder identifiers in `organization.identifiers` that it does not
  submit). On `201` the service answers with the uuids it minted for the
  `lid`s; the local changes are discarded, the client-side new records are
  unloaded and every record is reloaded from the backend. `submit` returns a
  `Map` from each submitted record to its reloaded record (a fresh record for
  the new ones).
- A failed `submit` rejects with a `ChangeRequestError` whose `message` is
  for the user (from the JSON:API `errors` array when there is one). Its flags
  say what the page does with its edits:
  - no flag: the service refused (`4xx`) or the request never left; nothing is
    touched, the page keeps its edits and shows the message for a correction
    and a retry;
  - `outcomeUnknown` (a `5xx`): the service may have applied the request
    before the dispatcher or the service gave up; the page shows the message
    and blocks the save button until it is reloaded, since a retry could apply
    the change twice;
  - `applied` (the service answered `2xx` but the answer lacks a minted id or
    a reload failed): the change is in the application graph; the page leaves
    with a warning toast, the index page loads the applied state.
- `permissions(targetId)` asks `GET /change-requests/permissions?target=…`
  whether the session may edit an organisation and returns
  `{ canEdit, rules }`, `rules` being the names of the policy rules that
  granted it. When the check itself fails (no answer, an error status, a body
  that is not JSON) the organisation is treated as read-only.
- `loadPermissions(targetId)` fetches and keeps that answer per organisation;
  `canEditOrganization(targetId)` reads it. The organisation route loads the
  permissions in its model hook, so a child route's guard can ask
  `canEditOrganization` for the organisation of the transition
  (`paramsFor('organizations.organization').id`), and tells the service which
  organisation is on screen once the transition is committed
  (`enterOrganization` in `setupController`, `leaveOrganization` in
  `deactivate`). `canEdit`, which `currentSession.canEdit` and the
  `SecuredArea` component read, is the answer for that organisation only, so
  an answer for another organisation, however late it arrives, never shows
  edit actions on the wrong pages. The service checks again on every submit;
  these answers only decide what the pages show.

The request document, here for a new site with its address on an
administrative unit:

```json
{
  "data": {
    "type": "change-requests",
    "attributes": {
      "aggregate": "site",
      "operations": [
        {
          "op": "create",
          "data": {
            "type": "addresses",
            "lid": "4b6e…",
            "attributes": { "street": "…" }
          }
        },
        {
          "op": "create",
          "data": {
            "type": "sites",
            "lid": "c1d2…",
            "relationships": {
              "address": { "data": { "type": "addresses", "lid": "4b6e…" } }
            }
          }
        },
        {
          "op": "update",
          "data": {
            "type": "administrative-units",
            "id": "9a01…",
            "relationships": {
              "primary-site": { "data": { "type": "sites", "lid": "c1d2…" } }
            }
          }
        }
      ]
    },
    "relationships": {
      "target": { "data": { "type": "organizations", "id": "9a01…" } }
    }
  }
}
```

`op` is `create` for a new record, `update` for a persisted one and `delete`
for a record whose deletion is pending.

The type of an operation is the record's own resource type, as the serializer
writes it: an organisation is sent as `administrative-units`,
`registered-organizations`, … (its subtype), and the service accepts every
subtype of a type in the aggregate. Only the `target` of the request is
always `organizations`.

### Aggregates

An aggregate is the set of records one page saves together; the service only
accepts the types that belong to it.

| Aggregate                | Page                                         | Records, in the order they are sent                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `organization-core-data` | Kerngegevens (`core-data/edit`)              | the address and the contact points when changed, the primary site when new or when a contact point was added, the KBO (when the type requires one) and SharePoint structured identifiers and identifiers, the organisation                                         |
| `site`                   | Vestigingen (`sites/new`, `sites/site/edit`) | the contact points and the address when changed (always for a new site), the site, the organisation: always on `sites/new`, where it links the new site through its `sites` or `primary-site` relationship, and on `sites/site/edit` when the primary site changes |

The werkingsgebied of the kerngegevens page is resolved through the
`scope-of-operation` service (`app/services/scope-of-operation.js`) before the
request is built. When that service does not answer, the field is disabled
and the werkingsgebied is left as it is; when the lookup of a changed
werkingsgebied fails, the save stops with a message and nothing is sent.

### Contract points for the change-request service

What the frontend sends and expects beyond the examples above; to be settled
with the service:

- The `site` aggregate carries an operation on the organisation (its subtype
  `administrative-units`, `registered-organizations`, …) on every `sites/new`
  save and on a `sites/site/edit` save that changes the primary site, with
  only its `sites` and `primary-site` relationships of interest. A whitelist of
  `sites`, `addresses` and `contact-points` alone refuses every new site.
- The type of the root operation is the record's subtype, never the aggregate
  root itself (see above).
- A `lid` is a UUID the browser generates per new record and per request.
  After a `5xx` the frontend blocks a retry until the page is reloaded; the
  service may use the `lid` as an idempotency key (reject or reuse a `lid` it
  already minted) so that a retry can never duplicate a create.
- The werkingsgebied (`scope`, type `locations`) is not a member of the
  `organization-core-data` aggregate, so the service leaves it as it is on the
  master; the kerngegevens page can only change it once the aggregate admits
  it and the `scope-of-operation` service, which mints locations outside the
  change-request policy, is part of the stack.

## Releasing a new version

We use [`release-it`](https://github.com/release-it/release-it) to handle our release flow.

### Generating the changelog

We use [`lerna-changelog`](https://github.com/lerna/lerna-changelog) to generate a basic changelog based on the merged PRs. Make sure all relevant PRs have a label, otherwise they will not be included in the changelog.

> `lerna-changelog` requires a Github [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) to work properly.

The following command can be used to generate the changelog:

`GITHUB_AUTH=your-access-token npx lerna-changelog`

### Creating a new release

Simply run `GITHUB_AUTH=your-access-token npm run release` and follow the prompts.

> If you generated the changelog using lerna-changelog you can add it to the changelog file and add it to the staged changes when release-it asks if you want to commit the changes. This will ensure that the changelog change is part of the release commit.

After the new tag is created and pushed CI will take care of building the docker image.
