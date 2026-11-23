import { attr, belongsTo } from '@warp-drive/legacy/model';
import AbstractValidationModel from './abstract-validation-model';
import Joi from 'joi';
import {
  validateBelongsToOptional,
  validateStringOptional,
  validateUrl,
} from '../validators/schema';

export default class DecisionModel extends AbstractValidationModel {
  @attr('date') publicationDate;
  @attr('uri-set', {
    defaultValue: function () {
      return [];
    },
  })
  documentLinks;
  // The plan says `@attr('string')`, but this app registers no `string`
  // transform; a bare attr is how every other text attribute is declared.
  @attr description;
  @attr geenLinkBeschikbaar;

  @belongsTo('decision-activity', {
    inverse: 'givesCauseTo',
    async: true,
  })
  hasDecisionActivity;

  get isEmpty() {
    // TODO: should this not also check for an activity?
    return !(
      this.publicationDate ||
      this.documentLinks?.some((link) => link) ||
      this.description?.trim() ||
      this.geenLinkBeschikbaar?.trim()
    );
  }

  get validationSchema() {
    return Joi.object({
      // TODO: is the date really optional?
      publicationDate: Joi.date().allow(null),
      documentLinks: Joi.array()
        .items(validateUrl('Geef een geldig internetadres in'))
        .optional(),
      description: validateStringOptional(),
      geenLinkBeschikbaar: validateStringOptional(),
      hasDecisionActivity: validateBelongsToOptional(),
    });
  }
}
