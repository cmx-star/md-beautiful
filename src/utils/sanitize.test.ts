import { describe, it, expect, beforeAll } from 'vitest';
import { sanitizeHtml } from './sanitize';

beforeAll(() => {
  // jsdom does not provide a native `alert`; provide a no-op stub so the
  // sanitizer's HTML parsing of <script> tags does not throw.
  if (typeof globalThis.alert !== 'function') {
    (globalThis as unknown as { alert: () => void }).alert = () => {};
  }
});

describe('sanitizeHtml', () => {
  it('strips <script> tags and inline script content', () => {
    const out = sanitizeHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips onerror but keeps <img> with safe src', () => {
    const out = sanitizeHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    // <img> tag is allowed; the sanitizer keeps the <img> element after
    // stripping the dangerous on* handler attribute.
    expect(out.toLowerCase()).toContain('<img');
  });

  it('strips javascript: URLs from <a href>', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/href\s*=\s*["']?javascript:/i);
    expect(out).not.toMatch(/href\s*=\s*["']?javascript%3A/i);
  });

  it('strips data:text/html URLs from <a href>', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips <iframe> tags entirely', () => {
    const out = sanitizeHtml('<iframe src="https://evil.example.com"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('strips event handler attributes (onclick) from <a>', () => {
    const out = sanitizeHtml('<a href="https://ok.example.com" onClick="alert(1)">x</a>');
    expect(out).not.toContain('onclick');
  });

  it('strips ontoggle from disallowed elements like <details>', () => {
    const out = sanitizeHtml('<details ontoggle=alert(1)><summary>x</summary></details>');
    expect(out).not.toContain('ontoggle');
  });

  it('preserves safe structural tags <p> and <strong>', () => {
    const out = sanitizeHtml('<p>hello <strong>world</strong></p>');
    expect(out).toContain('<p>');
    expect(out).toContain('<strong>');
    expect(out).toContain('</strong>');
    expect(out).toContain('</p>');
  });

  it('keeps data-* attributes and <section> for dialect output', () => {
    const out = sanitizeHtml(
      '<section class="footnotes"><a class="wiki-link" data-wiki-target="note">x</a></section>'
    );
    expect(out).toContain('<section class="footnotes">');
    expect(out).toContain('data-wiki-target="note"');
  });

  it('still drops script inside <section>', () => {
    const out = sanitizeHtml('<section><script>alert(1)</script>ok</section>');
    expect(out).not.toContain('script');
    expect(out).toContain('ok');
  });
});
