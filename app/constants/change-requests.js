/**
 * The vocabulary of the change-request service as the pages show it: the
 * statuses of a request, the kinds of request, the steps a request takes,
 * and the labels of the records and fields a request carries. The keys are
 * the ones of the service's API (see the README section "Change requests").
 */

export const STATUS = {
  SUBMITTED: 'ingediend',
  INFORMATION_REQUESTED: 'informatie-gevraagd',
  APPROVED: 'goedgekeurd',
  APPLIED: 'afgehandeld',
  REJECTED: 'afgekeurd',
  WITHDRAWN: 'ingetrokken',
  FAILED: 'mislukt',
};

/**
 * One word per status where the designs ask for it ("Ingediend" rather than
 * "Aanvraag wordt gevalideerd"); the longer wording is the description.
 */
export const STATUS_LABELS = {
  [STATUS.SUBMITTED]: 'Ingediend',
  [STATUS.INFORMATION_REQUESTED]: 'Informatie gevraagd',
  [STATUS.APPROVED]: 'Goedgekeurd',
  [STATUS.APPLIED]: 'Afgehandeld',
  [STATUS.REJECTED]: 'Afgekeurd',
  [STATUS.WITHDRAWN]: 'Ingetrokken',
  [STATUS.FAILED]: 'Mislukt',
};

export const STATUS_DESCRIPTIONS = {
  [STATUS.SUBMITTED]: 'De aanvraag wordt gevalideerd door ABB.',
  [STATUS.INFORMATION_REQUESTED]:
    'ABB wacht op aanvullende informatie van de aanvrager.',
  [STATUS.APPROVED]: 'De aanvraag is goedgekeurd en wordt verwerkt.',
  [STATUS.APPLIED]: 'De gegevens zijn aangepast in het register.',
  [STATUS.REJECTED]: 'De aanvraag is afgekeurd.',
  [STATUS.WITHDRAWN]: 'De aanvraag is ingetrokken.',
  [STATUS.FAILED]:
    'Het doorvoeren van de goedgekeurde aanvraag mislukte; ABB past ze opnieuw toe.',
};

/**
 * The AuPill skin per status.
 */
export const STATUS_SKINS = {
  [STATUS.SUBMITTED]: 'border',
  [STATUS.INFORMATION_REQUESTED]: 'warning',
  [STATUS.APPROVED]: 'success',
  [STATUS.APPLIED]: 'success',
  [STATUS.REJECTED]: 'error',
  [STATUS.WITHDRAWN]: 'default',
  [STATUS.FAILED]: 'error',
};

/**
 * The statuses in which a request still waits for a decision.
 */
export const PENDING_STATUSES = [
  STATUS.SUBMITTED,
  STATUS.INFORMATION_REQUESTED,
];

export const KIND = {
  EDIT: 'edit',
  CREATION: 'creation',
  CHANGE_EVENT: 'change-event',
};

export const KIND_LABELS = {
  [KIND.EDIT]: 'Wijziging gegevens',
  [KIND.CREATION]: 'Nieuwe organisatie',
  [KIND.CHANGE_EVENT]: 'Veranderingsgebeurtenis',
};

export const STEP = {
  SUBMISSION: 'indiening',
  INFORMATION_REQUEST: 'informatievraag',
  INFORMATION_ANSWER: 'informatieantwoord',
  APPROVAL: 'goedkeuring',
  HANDLING: 'afhandeling',
  REJECTION: 'afkeuring',
  CONTEST: 'betwisting',
  WITHDRAWAL: 'intrekking',
  REAPPLY: 'hertoepassing',
};

/**
 * What the history shows for a step.
 */
export const STEP_LABELS = {
  [STEP.SUBMISSION]: 'Aanvraag ingediend',
  [STEP.INFORMATION_REQUEST]: 'Aanvullende informatie gevraagd',
  [STEP.INFORMATION_ANSWER]: 'Aanvullende informatie bezorgd',
  [STEP.APPROVAL]: 'Goedgekeurd',
  [STEP.HANDLING]: 'Gegevens aangepast in het register',
  [STEP.REJECTION]: 'Afgekeurd',
  [STEP.CONTEST]: 'Beslissing betwist',
  [STEP.WITHDRAWAL]: 'Aanvraag ingetrokken',
  [STEP.REAPPLY]: 'Opnieuw toegepast',
};

/**
 * The steps whose text the "Extra informatie" tab shows as a conversation.
 */
export const CONVERSATION_STEPS = [
  STEP.INFORMATION_REQUEST,
  STEP.INFORMATION_ANSWER,
  STEP.REJECTION,
  STEP.CONTEST,
];

export const OPERATION_LABELS = {
  create: 'Nieuw',
  update: 'Gewijzigd',
  delete: 'Verwijderd',
};

const ORGANIZATION_TYPES = [
  'organizations',
  'administrative-units',
  'registered-organizations',
];

const RESOURCE_LABELS = {
  organizations: 'Organisatie',
  identifiers: 'Identificator',
  'structured-identifiers': 'Identificator',
  sites: 'Vestiging',
  addresses: 'Adres',
  'contact-points': 'Contactgegevens',
  'change-events': 'Veranderingsgebeurtenis',
  'change-event-results': 'Resultaat van de veranderingsgebeurtenis',
  decisions: 'Besluit',
  'decision-activities': 'Beslissingsactiviteit',
  memberships: 'Relatie',
  'periods-of-time': 'Periode',
};

const FIELD_LABELS = {
  organizations: {
    name: 'Naam',
    'legal-name': 'Juridische naam',
    'alternative-name': 'Alternatieve naam',
    purpose: 'Doel',
    'expected-end-date': 'Geplande einddatum',
    classification: 'Type organisatie',
    'organization-status': 'Status',
    'legal-form': 'Juridische vorm',
    scope: 'Werkingsgebied',
    'additional-qualifications': 'Bijkomende kwalificatie(s)',
    'content-themes': 'Inhoudelijk thema',
    identifiers: 'Identificatoren',
    'primary-site': 'Primaire contactgegevens',
    sites: 'Vestigingen',
  },
  identifiers: {
    'id-name': 'Type',
    'structured-identifier': 'Waarde',
  },
  'structured-identifiers': {
    'local-id': 'Nummer',
  },
  sites: {
    'site-type-name': 'Naam',
    'site-type': 'Type vestiging',
    address: 'Adres',
    contacts: 'Contactgegevens',
  },
  addresses: {
    country: 'Land',
    street: 'Straat',
    number: 'Huisnummer',
    'box-number': 'Busnummer',
    postcode: 'Postcode',
    municipality: 'Gemeente',
    province: 'Provincie',
    'full-address': 'Adres',
    'address-register-uri': 'Adresregister',
  },
  'contact-points': {
    telephone: 'Telefoonnummer',
    email: 'E-mail',
    website: 'Website',
    type: 'Soort',
  },
  'change-events': {
    date: 'Datum',
    description: 'Beschrijving',
    type: 'Type',
    'original-organizations': 'Organisatie',
    'resulting-organizations': 'Resulterende organisatie',
    results: 'Resultaat',
    decision: 'Besluit',
  },
  'change-event-results': {
    'resulting-name': 'Nieuwe naam',
    status: 'Resulterende status',
    'resulting-legal-form': 'Resulterende juridische vorm',
    'resulting-scope': 'Resulterend werkingsgebied',
    'resulting-additional-qualifications':
      'Resulterende bijkomende kwalificatie(s)',
    'resulting-organization': 'Organisatie',
    'result-from': 'Veranderingsgebeurtenis',
  },
  decisions: {
    'document-links': 'Link naar het besluit',
    'document-link': 'Link naar het besluit',
    'publication-date': 'Publicatiedatum',
  },
};

/**
 * The JSON:API type under which the labels of a type are kept: the
 * organisation subtypes share the organisation's.
 */
function labelType(type) {
  return ORGANIZATION_TYPES.includes(type) ? 'organizations' : type;
}

/**
 * The label of a record type of the change-request API, or the type itself.
 */
export function resourceLabel(type) {
  return RESOURCE_LABELS[labelType(type)] ?? type;
}

/**
 * The label of a field (attribute or relationship) of a record type, or the
 * key itself.
 */
export function fieldLabel(type, key) {
  return FIELD_LABELS[labelType(type)]?.[key] ?? key;
}

/**
 * The position of a field in the order the pages show the fields of a type
 * (the order of the labels above: the name first); a field without a label
 * comes last.
 */
export function fieldRank(type, key) {
  const keys = Object.keys(FIELD_LABELS[labelType(type)] ?? {});
  const index = keys.indexOf(key);
  return index === -1 ? keys.length : index;
}

/**
 * Whether a JSON:API type is an organisation type.
 */
export function isOrganizationType(type) {
  return ORGANIZATION_TYPES.includes(type);
}
