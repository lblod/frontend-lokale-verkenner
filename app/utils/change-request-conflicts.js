import { isLoaded } from 'frontend-organization-portal/utils/records';

/*
 * The labels the edit pages give their fields, per key of the change-request
 * API, to name the fields of a held change request's conflicts.
 */

/**
 * The address on the contact card (`Site::ContactEditCard`).
 */
export const ADDRESS_LABELS = {
  country: 'Land',
  street: 'Straat',
  number: 'Huisnummer',
  'box-number': 'Busnummer',
  postcode: 'Postcode',
  municipality: 'Gemeente',
  province: 'Provincie',
  'full-address': 'Adres',
  'address-register-uri': 'Adres',
};

/**
 * The primary contact point on the contact card.
 */
export const PRIMARY_CONTACT_LABELS = {
  telephone: 'Primair telefoonnummer',
  email: 'E-mail',
  website: 'Website',
};

/**
 * The secondary contact point on the contact card.
 */
export const SECONDARY_CONTACT_LABELS = {
  telephone: 'Secundair telefoonnummer',
};

/**
 * The site on the vestiging pages.
 */
export const SITE_LABELS = {
  'site-type': 'Type vestiging',
  'site-type-name': 'Naam',
  address: 'Adres',
  contacts: 'Contactgegevens',
};

/**
 * The organisation on the vestiging pages, which links the site.
 */
export const ORGANIZATION_SITE_LABELS = {
  'primary-site': 'Primair correspondentieadres',
  sites: 'Vestigingen',
};

/**
 * The organisation on the kerngegevens page.
 */
export const ORGANIZATION_CORE_DATA_LABELS = {
  name: 'Naam',
  'legal-name': 'Juridische naam',
  'alternative-name': 'Alternatieve naam',
  'legal-form': 'Juridische vorm',
  'content-themes': 'Inhoudelijk thema',
  'additional-qualifications': 'Bijkomende kwalificatie(s)',
  'recognized-worship-type': 'Soort eredienst',
  denomination: 'Strekking',
  'cross-border': 'Grensoverschrijvend',
  scope: 'Werkingsgebied',
  'expected-end-date': 'Geplande einddatum',
  purpose: 'Doel',
  'primary-site': 'Primaire contactgegevens',
  identifiers: 'Identificatoren',
};

/**
 * The primary site on the kerngegevens page, whose address and contact
 * points it shows as the primary contact data.
 */
export const PRIMARY_SITE_LABELS = {
  address: 'Primaire contactgegevens',
  contacts: 'Primaire contactgegevens',
};

/**
 * The fields of a held change request's conflicts as the page names them:
 * in the order of the conflicts, each once, by the label the page gives that
 * key of that record, or by the key itself when it has none.
 *
 * @param {Object[]} conflicts - `ChangeRequestError.conflicts`, each
 *     `{ resource: { type, id }, key, ... }`
 * @param {Array<[Model, Object<string, string>]>} labels - the records of
 *     the page, each with the labels of its keys; records that are not
 *     persisted (or no longer loaded) are skipped, a conflict is always about
 *     a persisted record
 * @returns {string[]}
 */
export function conflictingFields(conflicts, labels) {
  const labelsById = new Map(
    labels
      .filter(([record]) => isLoaded(record) && record.id)
      .map(([record, keyLabels]) => [record.id, keyLabels]),
  );
  const fields = conflicts.map(
    ({ resource, key }) => labelsById.get(resource?.id)?.[key] ?? key,
  );
  return [...new Set(fields)];
}

/**
 * The notice of a save the service did not apply, as
 * `Error::ChangeRequestHeld` takes it: the uuid of the request that waits
 * for ABB (to withdraw it; null for a stale edit the service refused),
 * whether a request waits at all, the fields in conflict as the page names
 * them, and whether the records could not be reloaded.
 *
 * @param {ChangeRequestError} error - a held one
 * @param {Array<[Model, Object<string, string>]>} labels - see
 *     `conflictingFields`
 * @returns {{ id: string|null, fields: string[], reloadFailed: boolean, waiting: boolean }}
 */
export function heldRequestNotice(error, labels) {
  return {
    id: error.requestId,
    fields: conflictingFields(error.conflicts, labels),
    reloadFailed: error.reloadFailed,
    waiting: error.waiting,
  };
}

/**
 * Tell the user that the last save was not applied when the page could not
 * show its notice: refreshing the page afterwards failed (the router then
 * shows the error page) or was overtaken by another transition. The toast
 * outlives the page.
 *
 * @param {Object} toaster - the toaster service
 * @param {Error} error - why the page could not be refreshed
 * @param {boolean} [waiting] - whether a request waits for ABB (a stale
 *     edit the service refused waits for no one: the user enters it again)
 */
export function reportHeldRequest(toaster, error, waiting = false) {
  console.warn(
    'The page could not be refreshed after the change request was not applied:',
    error,
  );
  toaster.warning(
    waiting
      ? 'Je wijziging werd niet doorgevoerd omdat iemand anders intussen dezelfde gegevens heeft gewijzigd. Je aanvraag wacht op een beslissing van ABB.'
      : 'Je wijziging werd niet doorgevoerd omdat iemand anders intussen dezelfde gegevens heeft gewijzigd. Herlaad de pagina en voer je wijziging opnieuw in.',
    'Wijziging niet doorgevoerd',
  );
}
