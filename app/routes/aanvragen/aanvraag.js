import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';
import { ChangeRequestError } from 'frontend-organization-portal/services/change-requests';

/**
 * One change request: the document of the service with its steps, conflicts
 * and the operations it was submitted with, the requesting organisation and
 * the organisation it is about (when that one is registered).
 */
export default class AanvragenAanvraagRoute extends Route {
  @service changeRequests;
  @service store;

  async model(params) {
    let request;
    try {
      request = await this.changeRequests.find(params.id);
    } catch (error) {
      if (error instanceof ChangeRequestError) {
        // Not found, not visible, not logged in, or the service does not
        // answer: the page says so in Dutch instead of the error page
        return { error, rights: this.modelFor('aanvragen') };
      }
      throw error;
    }
    const requesterId =
      request.relationships?.['requesting-organisation']?.data?.id ?? null;
    const target = request.relationships?.target ?? null;
    const classificationId = request.attributes['target-classification'];

    const [requester, targetOrganization, classification] = await Promise.all([
      requesterId ? this.loadRecord('organization', requesterId) : null,
      isRegistered(target)
        ? this.loadRecord('organization', target.data.id)
        : null,
      classificationId
        ? this.loadRecord('organization-classification-code', classificationId)
        : null,
    ]);

    return {
      request,
      requesterId,
      requester,
      targetOrganization,
      targetPending: target?.meta?.pending === true,
      targetUnregistered: target?.meta?.registered === false,
      classification,
      rights: this.modelFor('aanvragen'),
    };
  }

  /**
   * A record the request names, or null when the backend does not have it:
   * the page shows what it can.
   */
  async loadRecord(modelName, id) {
    try {
      const { content } = await this.store.request(findRecord(modelName, id));
      return content;
    } catch {
      return null;
    }
  }

  /**
   * A modal left open on one request must not open on the next one.
   */
  resetController(controller) {
    super.resetController(...arguments);
    controller.reset();
  }
}

/**
 * Whether the organisation a request is about is registered: the service
 * says it is not (`meta.registered` false) for a creation whose organisation
 * waits or was never registered; an older service only said that one waits
 * (`meta.pending`).
 */
export function isRegistered(target) {
  return (
    Boolean(target?.data?.id) &&
    target.meta?.registered !== false &&
    target.meta?.pending !== true
  );
}
