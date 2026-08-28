import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { createDialectSession } from './markdownDialect';

function parse(source: string): { html: string; footnotes: string } {
  const session = createDialectSession();
  marked.setOptions({ gfm: true, breaks: true });
  const html = (marked.parse(source, { async: false }) as string) ?? '';
  // Attach extensions via marked.use — need per-call extension list.
  return { html, footnotes: session.takeFootnoteSection() };
}

// marked.use is global; instead register per-parse with `marked.parse(src, {})`
// is not supported for extensions, so we build a local marked instance.
import { Marked } from 'marked';

function parseWithDialect(source: string): { html: string; footnotes: string } {
  const session = createDialectSession();
  const instance = new Marked({ gfm: true, breaks: true, extensions: session.extensions });
  const html = (instance.parse(source) as string) ?? '';
  return { html, footnotes: session.takeFootnoteSection() };
}

describe('wiki links', () => {
  it('renders [[target]] as a wiki-link anchor', () => {
    const { html } = parseWithDialect('see [[My Note]] here');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-target="My Note"');
    expect(html).toContain('My Note</a>');
  });

  it('supports alias syntax [[target|alias]]', () => {
    const { html } = parseWithDialect('[[Long Title|短名]]');
    expect(html).toContain('>短名</a>');
    expect(html).toContain('data-wiki-target="Long Title"');
  });

  it('escapes html in targets and labels', () => {
    const { html } = parseWithDialect('[[<script>alert(1)</script>]]');
    expect(html).not.toContain('<script>alert(1)</script>]]');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('footnotes', () => {
  it('numbers references and emits a definitions section', () => {
    const { html, footnotes } = parseWithDialect(
      '正文一[^1] 正文二[^note]\n\n[^1]: 第一条脚注\n[^note]: 第二条脚注\n'
    );
    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('href="#fn-1"');
    expect(footnotes).toContain('<section class="footnotes">');
    expect(footnotes).toContain('第一条脚注');
    expect(footnotes).toContain('第二条脚注');
  });

  it('produces no section when there are no footnotes', () => {
    const { footnotes } = parseWithDialect('plain text');
    expect(footnotes).toBe('');
  });

  it('does not treat [^x]: inside code as a definition', () => {
    const { html, footnotes } = parseWithDialect('```\n[^1]: not a footnote\n```\n');
    expect(footnotes).toBe('');
    expect(html).toContain('[^1]: not a footnote');
  });

  it('leaves plain markdown untouched', () => {
    const { html } = parseWithDialect('# Title\n\n**bold** and `code`\n');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
  });
});

describe('parse helper sanity', () => {
  it('global marked still works without dialect extensions', () => {
    const { html } = parse('# ok\n');
    expect(html).toContain('<h1');
  });
});
