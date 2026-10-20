import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord } from '@warp-drive/legacy/compat/builders';

/**
 * One change request: the document of the service with its steps, conflicts
 * and the operations it was submitted with, the requesting organisation and
 * the organisation it is about (when that one exists already).
 */
export default class AanvragenAanvraagRoute extends Route {
  @service changeRequests;
  @service store;

  async model(params) {
    const request = await this.changeRequests.find(params.id);
    const requesterId =
      request.relationships?.['requesting-organisation']?.data?.id ?? null;
    const target = request.relationships?.target ?? null;
    const targetExists = Boolean(target?.data?.id) && !target?.meta?.pending;
    const classificationId = request.attributes['target-classification'];

    const [requester, targetOrganization, classification] = await Promise.all([
      requesterId ? this.loadRecord('organization', requesterId) : null,
      targetExists ? this.loadRecord('organization', target.data.id) : null,
      classificationId
        ? this.loadRecord('organization-classification-code', classificationId)
        : null,
    ]);

    return {
      request,
      requesterId,
      requester,
      targetOrganization,
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
}
