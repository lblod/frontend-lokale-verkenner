import DOMPurify from 'dompurify';

/**
 * What the rich-text editor (`RichTextEditor`) writes, from the nodes and
 * marks of its schema: paragraphs and blocks, headings, lists, tables, links,
 * images, code, line breaks and rules, and the text styles, plus the tags
 * those marks are read from (`i`, `b`, `s`). Its RDFa nodes are spans and
 * divs with RDFa attributes.
 */
const ALLOWED_TAGS = [
  'p',
  'div',
  'span',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'em',
  'i',
  'strong',
  'b',
  'u',
  'del',
  's',
  'sub',
  'sup',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'title',
  'src',
  'alt',
  'width',
  'height',
  'colspan',
  'rowspan',
  // RDFa
  'about',
  'content',
  'datatype',
  'inlist',
  'lang',
  'prefix',
  'property',
  'rel',
  'resource',
  'rev',
  'typeof',
  'vocab',
];

/**
 * Rich text (the Doel of an organisation) cleaned for rendering as HTML:
 * only the tags and attributes the editor writes are kept, so markup that
 * was stored through another way than the editor (a hand-made change
 * request) cannot run a script or take over the page. DOMPurify also drops
 * any link or image whose address is not a safe one (`javascript:`), and
 * keeps the `data-` attributes the editor writes.
 *
 * @param {string|null|undefined} html
 * @returns {string}
 */
export function sanitizeRichText(html) {
  if (typeof html !== 'string' || html === '') {
    return '';
  }
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
