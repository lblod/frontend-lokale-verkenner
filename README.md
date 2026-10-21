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
history and applies it to the organisation data. An edit of an organisation's
own data is applied immediately, unless someone else changed the same data
since the page loaded it: the service then refuses it and the page shows the
current values (see [Held requests](#held-requests)). An edit that changes
nothing is not sent. The service keeps an applied edit as history only: the
overviews do not list edits, a request page shows one by its URL. A request to
register a new organisation or a veranderingsgebeurtenis waits for a decision
by ABB; ABB's own is applied at once, unless data it changes was changed
since its form was loaded: then it waits for ABB's goedkeuring on its request
page too. The pages under `/aanvragen` show those requests and take the steps
(see [The request pages](#the-request-pages)). The resource routes are
read-only for this application: the backend refuses a write on them, and the
pages that still contain such a write (see the table) are closed.

### Which pages edit

| Page                                                           | Status                                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kerngegevens (`core-data/edit`)                                | change request, aggregate `organization-core-data`; juridische vorm, werkingsgebied and bijkomende kwalificatie are shown only, they change through a veranderingsgebeurtenis |
| Vestigingen (`sites/new`, `sites/site/edit`)                   | change request, aggregate `site`                                                                                                                                              |
| Veranderingsgebeurtenissen (`change-events/new`)               | change request, aggregate `change-event` (see [The request pages](#the-request-pages))                                                                                        |
| Veranderingsgebeurtenissen (`change-events/details/edit`)      | not switched yet: the edit route redirects to `unauthorized` and the page shows no edit action                                                                                |
| Gerelateerde organisaties (`related-organizations/edit`)       | not switched yet: idem                                                                                                                                                        |
| Betrokken lokale besturen (`local-involvements/edit`, worship) | not switched yet: idem                                                                                                                                                        |
| Bestuursorganen (`governing-bodies/governing-body/edit`)       | read-only, mastered by LMB: the edit route redirects and the page shows no edit action                                                                                        |
| Nieuwe organisatie (`organizations/new`)                       | change request, aggregate `new-organisation` (see [The request pages](#the-request-pages))                                                                                    |
| Nieuwe positie (`people/new-position`)                         | a static notice without a save; its guard reads `canEdit`, which is false outside the organisation pages                                                                      |

A page is switched by replacing its chain of `saveRecord` calls with one
`submit` and by handling `ChangeRequestError` as the switched pages do,
including a held request (refresh the route that loads the page's records,
build the form again and show `Error::ChangeRequestHeld` with the page's
labels for the fields, see [Held requests](#held-requests)) and a failed
apply (block saving and link to the kept request, see
[Failed applies](#failed-applies)).

### The request pages

`/aanvragen` ("Alle aanvragen") lists the creations and change events the
session may see (the service lists edits only for `filter[kind]=edit`, which
the page never asks), oldest first, 20 per page, with the filters of the
designs as query parameters: the requesting organisation (`requester`), only
mine (`mine`), the kind (`kind`: `creation` or `change-event`; another value,
such as `edit` from an old link, is no filter), the classification of the
organisation the request is about (`targetClassification`), that organisation
(`organization`; not `target`, which every Ember controller already owns),
the period (`createdFrom`, `createdUntil`, as `YYYY-MM-DD`), the status
(`status`; "Goedgekeurd" is not offered, the afhandeling follows it in the
same update) and the sort (`created` or `-created`). The route asks the
service one page (`changeRequests.list`), gives the rows the pagination
metadata the data table's pager reads (as mu-search gives it), and resolves
the organisations and classifications it names through the store. The two
organisation filters search the organisations of every classification the
register knows, the requester filter ABB's own too; the records the URL
names are loaded for the selects (`loadSelectedRecords`). Each row links to
the request; the organisation a request is about links to its page when it
is registered, a new organisation that still waits is shown "(in aanvraag)"
and one that was never registered (the creation was rejected, withdrawn or
failed) "(niet geregistreerd)", as the service's `meta` of the target says.
The pages have the navigation bar of the organisation pages, with "← Loket"
and the breadcrumbs back to the list.

`/aanvragen/:id` shows one request: its status with a description, who
requested it and when, and three tabs. "Aanvraagformulier" renders the
operations the request was submitted with (`ChangeRequests::Operations`: one
card per record, the records it creates named from their own operation, the
others loaded from the store); "Extra informatie" the exchange between ABB
and the requester (questions, answers, rejections, contests);
"Aanvraaggeschiedenis" every step with who took it and the resulting status.
What the viewer may do comes from the status and the rights the `aanvragen`
route loaded (`changeRequests.loadRights`): ABB approves, rejects, asks for
information and withdraws; the requesting organisation answers a question,
contests a rejection and withdraws. An edit takes none of the decision steps:
a failed one is withdrawn. Applying a failed request again (a `hertoepassing`)
is not in the designs, so the page does not offer it; the service keeps the
step for API use. Every action is a `ChangeRequests::StepModal`, which posts
the step (`changeRequests.takeDecision`) and refreshes the page; when the
apply of a goedkeuring fails, the page says so and shows the request anew
(now `mislukt`). The route resets the page's controller when the request
changes, so a modal left open does not open on the next request. An approval
over data that changed since the request was submitted shows the conflicts,
relationship values by the name of the record, and needs a confirmation; the
modal then sends the service's `conflicts-token`, so it overrides exactly
the conflicts the reviewer saw. A request that cannot be fetched (not found,
not visible, not logged in, no answer) is a message on the page. The service
shows the
person who submitted a request and the texts of the steps to the requesting
organisation and ABB only; the pages never name a person, only the
organisation. The labels of statuses, kinds, steps and fields live in
`app/constants/change-requests.js`. The Doel of an organisation, which the
rich-text editor writes as HTML, is shown through the `rich-text` helper,
which keeps only the tags and attributes the editor writes
(`app/utils/rich-text.js`, DOMPurify), on the kerngegevens page as in the
Aanvraagformulier.

`/organisaties/nieuwe-organisatie` ("Voeg organisatie toe") is the creation
form: OP's form without the related-organisation fields and the worship
types, with the date of the oprichting (required, as for every new change
event), the link to the besluit tot oprichting and an explanation for ABB.
It opens for who may request an organisation (`changeRequests.rights`: ABB,
or an organisation that manages others) and offers only the classifications
the service allows (`ClassificationSelect @allowedIds`). It submits the
organisation (an `administrative-units` or `registered-organizations`
document, as the classification demands; a Vlaamse gemeenschapscommissie is
an administrative unit), its KBO and SharePoint identifiers, its primary site
with address and contact points (OP's "Maatschappelijke zetel" as the site
type of an AGB, APB, IGS, politiezone, hulpverleningszone, OCMW-vereniging,
PEVA or Andere; the primary site is not also one of its `sites`), and the
oprichting as a change event with its date, its result (the status the
organisation starts with, so the organisation's veranderingsgebeurtenissen
page lists it) and its besluit when one was filled in, as one request
(aggregate `new-organisation`, no target). ABB's request is applied at once
and the page goes to the new organisation; anyone else's waits and the page
goes to the request (with the `aanvragen` loading substate while it loads),
as does ABB's own when it waits over changed data, with a notice for ABB. A
KBO number that is registered or requested already is shown on the field.
An applied request the page cannot follow up, or whose apply failed, goes to
the request page; when the outcome is unknown (a 5xx, no answer) the form
blocks a new attempt until the page is reloaded, since it could register the
organisation twice; a browser that knows it is offline sent nothing, so that
attempt can be repeated. The werkingsgebied comes from the scope-of-operation
service, as in OP (the stack runs it). The related organisations of the new
one (its founder) are not part of the request yet.

`/organisaties/:id/veranderingsgebeurtenissen/nieuw` is the change-event
form: OP's form for one organisation (the types about several organisations,
fusie and samenvoeging, are left out through `ChangeEventTypeSelect
@excludeIds`), with the links to the besluit and an explanation for ABB. Its
route loads the fields an event may change (status, juridische vorm,
werkingsgebied, qualifications) before the form changes them, since the
request carries their loaded values as its base. It submits the event, its
result (the resulting status, legal form, werkingsgebied, qualifications or
new name, as OP derives them) and the fields of the organisation the event
changes as one request (aggregate `change-event`, target the organisation);
the organisation only follows the event when no later event is recorded yet,
as in OP. ABB's request is applied at once and the page goes to the event;
anyone else's waits and the page goes to the request, as does ABB's own when
it waits over changed data. A refused request leaves the organisation as it
was loaded, so another attempt starts from it; the other outcomes are handled
as on the creation form. The overview of the organisation's events lists the
requests that are not applied yet (waiting, or rejected and still to be
contested) with the type and date of the event each proposes and a link to
it. Not in the request: ending the relations of a dissolved organisation (OP
does that on save; it follows with the related-organisations work).

### The entry from Loket

`/mijn-organisatie` lands the user on the kerngegevens of the organisation
they are logged in for (the session's group), so Loket can link to it
without knowing the organisation's id; a visitor who is not logged in goes to
the login page first. With `EMBER_LOKET_URL` set on the frontend container
(the image fills the `{{LOKET_URL}}` placeholder of `loketUrl` in the config
from it) the navigation bar starts with a "← Loket" link; without it no link
is shown.

### The `change-requests` service

`app/services/change-requests.js`:

- `submit(aggregate, target, records, { reason })` posts the proposed state
  of one aggregate. `target` is the uuid of the organisation the request is
  about (null for a new organisation, which has none yet), `reason` the
  submitter's explanation for ABB, `records` the Ember Data records of the
  aggregate, dependencies first (the
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
  submit). Every update carries the values the record was loaded with as its
  base (see [Base values](#base-values)). On `201` with status `afgehandeld`
  the service answers with the uuids it minted for the `lid`s; the local
  changes are discarded, the client-side new records are unloaded and every
  record is reloaded from the backend. `submit` returns a `Map` from each
  submitted record to its reloaded record (a fresh record for the new ones).
  A request that changes nothing the service holds is stored by nothing:
  `200` with `{ "data": null, "meta": { "unchanged": true } }`, after which
  the records are reloaded as after an applied request. On `201` with status
  `ingediend` the request is held, see [Held requests](#held-requests).
- `hasChanges(records)` tells whether `submit` would change anything: a new
  or deleted record does, an update only when a key it carries differs from
  its base (lists compare as sets). The kerngegevens and vestiging pages
  leave without a request when nothing changed.
- A failed `submit` rejects with a `ChangeRequestError` whose `message` is
  for the user (from the JSON:API `errors` array when there is one). Its flags
  say what the page does with its edits:
  - no flag: the service refused (`4xx`); nothing is touched, the page keeps
    its edits and shows the message for a correction and a retry. A KBO
    number another organisation has, or a creation that waits proposes, is
    a `409` with `meta["kbo-number"]` (`kboConflictMessage`): the creation
    and kerngegevens forms show it on the KBO field;
  - `outcomeUnknown` (a `5xx`, no answer at all, or a `2xx` whose body cannot
    be read): the service may have applied or recorded the request; the page
    shows the message and blocks the save button until it is reloaded, since
    a retry could apply the change twice;
  - `applied` (the service answered `2xx` but the answer lacks a minted id or
    a reload failed): the change is in the application graph; the page leaves
    with a warning toast, the index page loads the applied state (the
    creation form goes to the request, `requestId`);
  - `held`: nothing is applied. For an edit the service refused it with
    `409` because someone else changed the same data; for a new organisation
    or a veranderingsgebeurtenis it answered `201` with status `ingediend`:
    the request waits for ABB (`waiting`, `requestId`). `conflicts` lists the
    fields someone else changed. `submit` has discarded the local changes,
    see [Held requests](#held-requests); `reloadFailed` is set when it could
    not reload the records afterwards;
  - `applyFailed` (a `409` whose `meta["change-request"]` has status
    `mislukt`): the service kept the request (`requestId`) but its apply
    failed; the page keeps its edits, blocks the save button and links to
    the kept request, see [Failed applies](#failed-applies).
- `withdraw(requestId)` withdraws a held request (an `intrekking` step,
  `POST /change-requests/:id/steps`). It rejects with a `ChangeRequestError`
  whose message says why not, in Dutch.
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
            },
            "meta": {
              "base": {
                "relationships": { "primary-site": { "data": null } }
              }
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
for a record whose deletion is pending. Only an update carries `meta.base`.

The type of an operation is the record's own resource type, as the serializer
writes it: an organisation is sent as `administrative-units`,
`registered-organizations`, … (its subtype), and the service accepts every
subtype of a type in the aggregate. Only the `target` of the request is
always `organizations`.

### Base values

The pages send every attribute of a record, and every relationship the store
has loaded, not only what the user changed. So that a form that was opened
before someone else saved does not overwrite that save, every `update`
operation carries in `data.meta.base` the values the record had when the page
loaded it, for the keys the operation carries:

```json
"meta": {
  "base": {
    "attributes": { "legal-name": "Gemeente Aalst", "alternative-name": ["Aalst"] },
    "relationships": {
      "primary-site": { "data": { "type": "sites", "id": "77c2…" } },
      "sites": { "data": [{ "type": "sites", "id": "77c2…" }] }
    }
  }
}
```

`serializeBase` in the service takes them from the store's cache: a changed
attribute has its value from before the change (`changedAttributes` gives
`[old, new]`), a changed relationship its remote state, and an unchanged key
its current value. They are written by the same serializer as the proposal,
so the keys, the transforms (ISO dates, arrays for a string set) and the
resource identifiers (`{ type, id }`, an array for a to-many, `null` for an
empty to-one) are those of the proposal, and an unchanged key has its
proposal as its base. One transform loses the stored form: `phone` reads
`tel:+32…` and a number stored without the prefix alike, always writes
`tel:`, and writes `""` as `null`, while the service compares a telephone
number exactly. The application serializer therefore keeps, when it loads a
record, the stored form of every telephone number it would write
differently (`loadedForm`), and the base of a changed number is that stored
form (`1770`, `""`), so that the service finds the value it holds. Every key
an update carries has a base: the attributes come with the record, the
serializer only sends a relationship the store has loaded or the page has
set, and the pages load a relationship before they change it, so its remote
state is the value on the server when the page was opened. That last part is
checked: mu-cl-resources sends a relationship that was not included as a
link, which the store reads as nothing (or as empty, for a synchronous one
such as `additionalQualifications`), so the application serializer notes
which relationships of a record came as a link only and the application
adapter which ones were loaded through their link since
(`relationshipLoaded`). A relationship without inverse that the page changed
but never loaded makes `submit` throw before anything is sent (the
change-event route therefore loads the fields an event may change). Creates
and deletes carry no base.

The service compares, per single-valued key (an attribute that is not a set,
a to-one relationship), the proposed value `P`, the base `B` and the current
value `C` on the master: `P = B` is a key the user did not change and is not
written; `C = B` is written; `C = P` is the same change made by someone else
and is not written either; any other `C` is a conflict, the proposal is kept
and the request is held. A set (a to-many relationship such as `sites` or
`contacts`, a set attribute such as `alternative-name`) merges instead: the
service adds what `P` has and `B` had not and removes what `B` had and `P`
has not, so what others changed in the meantime stays and a set never
conflicts. Two pages that each add a vestiging both get theirs; two pages
that each make their new vestiging the primary site conflict on
`primary-site`.

### Held requests

An edit of an organisation's own data is applied at once or not at all: when
the service finds a conflict (someone else changed the same field since the
page loaded it) it refuses the save with `409` and the conflicts, and nothing
is recorded. A request to register a new organisation or a
veranderingsgebeurtenis is recorded with status `ingediend` and answered with
`201` without applying anything; it waits for a decision by ABB on the
request pages. For the frontend both are neither a success nor a refusal:
`ChangeRequestError.held` is set for both, `waiting` only for a request that
waits for ABB (with its `requestId`). The edit pages only get the first; the
creation and change-event forms, which get the second, go to the request
page. What follows is how the edit pages handle a held save:

- `submit` discards the local changes, unloads the new records (they exist in
  the request only) and reloads the other records with the relationships the
  request changed, then rejects with a `ChangeRequestError` whose `held` flag
  is set, whose `requestId` is the request and whose `conflicts` are the
  service's list: per field the `resource` (`{ type, id }`), the `key`, the
  `base`, `current` and `proposed` values and the `competing-requests`.
- The page refreshes the route that loads its records with everything the
  form shows, so that also the records the request did not contain are
  current: the kerngegevens page refreshes `core-data` (the organisation with
  its primary site, address, contact points and identifiers), the page of a
  vestiging refreshes `sites.site` (the site with its address and contact
  points; the edit route reloads the organisation's sites itself), the page
  of a new vestiging its own route (the new records are created anew).
- Refreshing a route does not build its template again: Ember keeps every
  component and only passes the new model, so components that copy an
  argument when they are created (the address search, the rich-text editor,
  the qualifications choice) would keep showing the rejected values. After
  the refresh the page bumps `formRevision`, and its form, wrapped in
  `<Rebuild @key={{this.formRevision}}>`, is created anew from the reloaded
  records.
- The page then shows `Error::ChangeRequestHeld`: a warning that the change
  was not applied because someone else changed the same data in the
  meantime, naming the fields; the form shows the current values and the
  user enters the change again. (The notice still has a part for a request
  that waits for ABB, with a button that withdraws it, from when an edit
  could wait; no edit page reaches it any more.) When a save replaced earlier
  requests, the service lists them in `superseded` and `submit` shows a toast
  saying they were withdrawn. The names are the page's labels for the key of
  the record in conflict, from `app/utils/change-request-conflicts.js` (the
  key itself when there is no label). Refreshing resets the controller, so
  the notice is set afterwards.
- A new save is a new request, whose base is what the form now shows, and
  the service checks it against the current values again. On the page of a
  new vestiging a held request means that the site was not created; the
  notice says so and the form is empty again.
- When `submit` could not reload the records (`reloadFailed`, the error is
  logged), the store holds the values the page loaded, not the current ones:
  the notice asks for a reload and saving is blocked. When the refresh itself
  fails, the router shows the error page; a warning toast then says that the
  change was not applied.

### Failed applies

The service applies a request in one SPARQL update that is not one
transaction: when it fails twice it keeps the request with status
`mislukt`, and the apply may have stopped half-way, leaving the keys it
changes empty on the organisation. It answers `409` with
`meta["change-request"]` (`{ id, status: "mislukt" }`). A new save would
start from the values the page loaded, find the emptied keys and be refused
as a conflict, so the page keeps its edits, blocks the save button and shows a
link to the kept request ("Bekijk de aanvraag", `/aanvragen/:id`). Edits are
not listed in "Alle aanvragen", so the link is the only way to that request;
there the requester can withdraw it. Applying it again (a `hertoepassing`
step) is not in the designs, so the pages do not offer it; the service keeps
the step for API use.

### Aggregates

An aggregate is the set of records one page saves together; the service only
accepts the types that belong to it.

| Aggregate                | Page                                          | Records, in the order they are sent                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `organization-core-data` | Kerngegevens (`core-data/edit`)               | the address and the contact points when changed, the primary site when new or when a contact point was added, the KBO (when the type requires one) and SharePoint structured identifiers and identifiers, the organisation                                         |
| `site`                   | Vestigingen (`sites/new`, `sites/site/edit`)  | the contact points and the address when changed (always for a new site), the site, the organisation: always on `sites/new`, where it links the new site through its `sites` or `primary-site` relationship, and on `sites/site/edit` when the primary site changes |
| `new-organisation`       | Nieuwe organisatie (`organizations/new`)      | the KBO and SharePoint structured identifiers and identifiers, the contact points, the address and the primary site, the besluit when one was filled in, the oprichting (change event) and its result, the organisation                                            |
| `change-event`           | Veranderingsgebeurtenis (`change-events/new`) | the besluit when the type asks for one and one was filled in, the change event, its result, the organisation with the fields the event changes                                                                                                                     |

The edit routes create a placeholder for a contact point the site lacks and
for a missing SharePoint identifier. A new record is always dirty, so a
placeholder is only submitted, and linked from the site or the organisation,
once the user filled it in (`hasUserInput` in `app/utils/records.js`: an
attribute with a value other than the ones the route set, such as the `type`
of a contact point); otherwise every save would create an empty contact point
or identifier and change `contacts` or `identifiers`, lists nobody edited, so
that a save of the kerngegevens without changes would still write.

The kerngegevens page shows the juridische vorm, the werkingsgebied (its
label from the `scope-of-operation` service) and the bijkomende
kwalificaties without changing them: the service refuses a change to them
through `organization-core-data` or `site`, so they change through a
veranderingsgebeurtenis, to which the page links. The organisation is sent
with them unchanged, and a value the data lacks does not block the save. The
creation and change-event forms resolve a werkingsgebied through the
`scope-of-operation` service (`app/services/scope-of-operation.js`) before
the request is built; when that lookup fails, the save stops with a message
and nothing is sent.

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
- Per aggregate the service lets the organisation change only some keys:
  through `organization-core-data` its names, purpose, expected end date,
  themes, identifiers and sites; through `site` its sites; through
  `change-event` its names, status, legal form, werkingsgebied and
  qualifications. Any other key the frontend sends unchanged; a changed one
  is a `422` whose `source.pointer` names it.
- `meta.base` of an update carries, for every key the operation carries, the
  loaded value in the serialisation of the proposal (see
  [Base values](#base-values)), relationships included.
- A request the service does not apply answers `201` with
  `attributes.status` `ingediend`, its id in `data.id` and
  `attributes.conflicts`; the frontend reads `resource.id` and `key` of each
  conflict to name the field. It does not require `lids` in that answer. An
  edit that changes nothing answers `200` with
  `{ "data": null, "meta": { "unchanged": true } }`.
- A KBO number is unique: a creation, or a kerngegevens edit that sets or
  changes it, whose number another organisation has or a waiting creation
  proposes is a `409` with `errors[0].meta["kbo-number"]` and
  `meta.organisation` or `meta["change-request"]`; the same can come back on
  a goedkeuring or betwisting of a creation.
- In a listing and on a request, `relationships.target.meta` is
  `{ registered: false, pending: true }` for a creation that waits,
  `{ registered: false, pending: false }` for one whose organisation was
  never registered, and absent when the organisation exists.
- A failed apply answers `409` with `errors[].meta["change-request"]`
  `{ id, status: "mislukt" }`. Steps go to
  `POST /change-requests/:id/steps`; a `409` for a step the status does not
  admit carries that status in `errors[].meta.status`, which the frontend
  reads to treat a request withdrawn meanwhile as done. A failed edit is
  only applied again (`hertoepassing`, by ABB or the requesting
  organisation) or withdrawn (`intrekking`); the pages offer only the
  withdrawal, the `hertoepassing` stays for API use.

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
