import { helper } from '@ember/component/helper';
import { htmlSafe } from '@ember/template';
import { sanitizeRichText } from 'frontend-organization-portal/utils/rich-text';

/**
 * Rich text as HTML, cleaned (`sanitizeRichText`): how the pages show what
 * the rich-text editor wrote.
 */
export default helper(function richText([html]) {
  return htmlSafe(sanitizeRichText(html));
});
