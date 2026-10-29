import { module, test } from 'qunit';
import { sanitizeRichText } from 'frontend-organization-portal/utils/rich-text';

module('Unit | Utility | rich-text', function () {
  test('it keeps what the editor writes', function (assert) {
    const html =
      '<p>Het <strong>doel</strong> is <em>samenwerking</em>, zie <a href="https://aalst.be">de site</a>.</p><ul><li>afval</li></ul>';

    assert.strictEqual(sanitizeRichText(html), html);

    const link = new DOMParser()
      .parseFromString(
        sanitizeRichText(
          '<a href="https://aalst.be" target="_blank">de site</a>',
        ),
        'text/html',
      )
      .querySelector('a');
    assert.strictEqual(link.getAttribute('href'), 'https://aalst.be');
    assert.strictEqual(
      link.getAttribute('target'),
      '_blank',
      'the editor opens links in a new tab',
    );
  });

  test('it drops scripts, event handlers, unsafe links and styles', function (assert) {
    const cleaned = sanitizeRichText(
      '<p onclick="alert(1)" style="position:fixed">Doel</p><img src=x onerror="alert(2)"><script>alert(3)</script><a href="javascript:alert(4)">link</a><iframe src="https://evil.example"></iframe><svg><script>alert(5)</script></svg>',
    );

    assert.notOk(cleaned.includes('alert'), cleaned);
    assert.notOk(cleaned.includes('style'), cleaned);
    assert.notOk(cleaned.includes('iframe'), cleaned);
    assert.notOk(cleaned.includes('svg'), cleaned);
    assert.true(cleaned.includes('<p>Doel</p>'), cleaned);
    assert.true(cleaned.includes('<a>link</a>'), cleaned);
  });

  test('no value is an empty text', function (assert) {
    assert.strictEqual(sanitizeRichText(null), '');
    assert.strictEqual(sanitizeRichText(undefined), '');
    assert.strictEqual(sanitizeRichText(''), '');
  });
});
