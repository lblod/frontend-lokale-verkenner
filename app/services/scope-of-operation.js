import Service, { service } from '@ember/service';
import { findRecord, query } from '@warp-drive/legacy/compat/builders';
import splitArrayIntoGroups from '../utils/split-array-in-groups';

/**
 * The scope-of-operation service could not answer: it is not part of the
 * stack, does not respond, or something else than the service answered (the
 * dispatcher hands unknown routes to the frontend, which answers its
 * `index.html` with status 200). `message` is meant for the user.
 */
export class ScopeOfOperationError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'ScopeOfOperationError';
  }
}

export default class ScopeOfOperationService extends Service {
  @service store;

  getScopeServiceEndpoint(path, location) {
    const locationArg = location ? `/${location.id}` : '';
    return `/scope-of-operation/${path}${locationArg}`;
  }

  /**
   * Retrieve the label to be displayed for the provided organization's scope of
   * operation.
   * @param {Organization} organization - The organization for which to retrieve
   *     the label.
   * @returns {Promise<string | null>} The appropriate label that should be
   *     displayed for the organization's scope
   */
  async getScopeLabel(organization) {
    const scope = await organization.scope;

    return scope ? this.getLabelForLocation(scope) : undefined;
  }

  /**
   * Retrieve the label to be displayed for the provided scope-of-operation
   * location.
   * @param {Location} location - The location for which to retrieve the
   *     label.
   * @returns {Promise<string | undefined>} The appropriate label that should
   *     be displayed for the location, undefined when the service could not
   *     answer.
   */
  async getLabelForLocation(location) {
    const answer = await this.#fetchJson(
      this.getScopeServiceEndpoint('label-for-scope', location),
    );

    return answer?.body;
  }

  /**
   * Retrieve the location resources that are contained within the scope of
   * operation of the provided organization. The location resources contained
   * will be of the smallest level used, typically locations of municipality
   * level.
   * @param {Organization} organization - The organization for which the
   *     retrieve its locations.
   * @returns {Promise<Location[] | null>} An array containing the locations
   *     that are within the provided organization's scope of operation, empty
   *     when the organization has no scope; null when the organization has a
   *     scope but its locations could not be loaded, which the callers must
   *     not mistake for an empty werkingsgebied.
   */
  async getLocationsInScope(organization) {
    const scope = await organization.scope;

    if (!scope) {
      return [];
    }

    const answer = await this.#fetchJson(
      this.getScopeServiceEndpoint('locations-in-scope', scope),
    );
    if (!answer || !Array.isArray(answer.body)) {
      return null;
    }

    let locations = [];
    // NOTE (06/06/2025): For some cases the number of UUIDs can be very
    // long leading to `414 Request-URI Too Long` errors from the
    // backend. For example, for a province organisation the UUIDs of all
    // municipalities in that province would be returned. To avoid this
    // issue we manually split up the requests to the backend.
    const groupedUuids = splitArrayIntoGroups(answer.body, 20);
    for (let uuids of groupedUuids) {
      locations.push(...(await this.#fetchLocations(uuids)));
    }
    // NOTE (06/06/2025): In case multiple requests were performed, ensure
    // the combined result is sorted alphabetically.
    if (groupedUuids.length > 1) {
      locations = locations.sort((a, b) =>
        a.label.localeCompare(b.label, 'nl'),
      );
    }

    return locations;
  }

  /**
   * Retrieve the reference regions (nl. referentieregio's) covered by the
   * provided organization's scope of operation. An organization can cover
   * multiple reference regions; they are derived server-side from the
   * organization's werkingsgebied.
   * @param {Organization} organization - The organization for which to retrieve
   *     the reference regions.
   * @returns {Promise<Array<{uri: string, uuid: string, label: string}>>} The
   *     reference regions covered by the organization's scope, empty if none
   *     or when the service could not answer.
   */
  async getReferentieregiosInScope(organization) {
    const scope = await organization.scope;

    if (!scope) {
      return [];
    }

    const answer = await this.#fetchJson(
      this.getScopeServiceEndpoint('referentieregios-in-scope', scope),
    );

    return Array.isArray(answer?.body) ? answer.body : [];
  }

  async #fetchLocations(locationUuids) {
    const { content: locations } = await this.store.request(
      query('location', {
        filter: {
          ':id:': locationUuids.join(','),
        },
        sort: 'label',
      }),
    );

    return locations;
  }

  /**
   * Retrieve the location resource that exactly contains the provided
   * locations. This location can be assigned to an organisation as its scope of
   * operation.
   * @param {...Location} locations - The locations that should be contained.
   * @returns {Promise<Location | null>} - The location that exactly matches the
   *     provided ones, null if no locations were provided.
   * @throws {ScopeOfOperationError} when the service could not answer or the
   *     location it named could not be loaded.
   */
  async getScopeForLocations(...locations) {
    if (locations.length === 0) {
      return null;
    }

    const requestBody = {
      data: {
        locations: locations.map((location) => location.id),
      },
    };

    const answer = await this.#fetchJson(
      this.getScopeServiceEndpoint('scope-for-locations'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    const uuid = answer?.body;
    if (typeof uuid !== 'string' || uuid.length === 0) {
      throw new ScopeOfOperationError(
        'Het werkingsgebied kon niet bepaald worden: de werkingsgebied-service antwoordt niet. De wijzigingen zijn niet opgeslagen; probeer later opnieuw.',
      );
    }

    try {
      const { content: scopeResource } = await this.store.request(
        findRecord('location', uuid),
      );

      return scopeResource;
    } catch (error) {
      throw new ScopeOfOperationError(
        'Het werkingsgebied kon niet geladen worden. De wijzigingen zijn niet opgeslagen; probeer later opnieuw.',
        { cause: error },
      );
    }
  }

  /**
   * Call the scope-of-operation service and parse its JSON answer. The
   * dispatcher answers unknown routes with the frontend's `index.html` and
   * status 200, so the content type is checked, not only the status.
   *
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<{ status: number, body: unknown } | null>} null when the
   *     service could not be reached, answered an error status or something
   *     else than JSON
   */
  async #fetchJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { Accept: 'application/json', ...options.headers },
      });
    } catch (error) {
      console.warn(
        `Could not reach the scope-of-operation service (${url})`,
        error,
      );
      return null;
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (!response.ok || !contentType.includes('json')) {
      console.warn(
        `Unexpected answer from the scope-of-operation service for ${url}: HTTP ${response.status}${contentType ? ` ${contentType}` : ''}`,
      );
      return null;
    }

    try {
      return { status: response.status, body: await response.json() };
    } catch (error) {
      console.warn(
        `The scope-of-operation service answered invalid JSON for ${url}`,
        error,
      );
      return null;
    }
  }
}
