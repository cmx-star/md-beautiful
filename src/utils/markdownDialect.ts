/**
 * Markdown dialect extensions for the preview renderer (Phase 2).
 *
 * Dialect = CommonMark + GFM (marked defaults) + Frontmatter (rendered as
 * nothing / handled upstream) + Wiki Link `[[目标]]` / `[[目标|别名]]` +
 * footnotes `[^id]` with definitions.  Extensions are created per-parse so
 * footnote numbering never leaks between renders.
 */

export interface WikiToken {
  type: 'wikiLink';
  raw: string;
  target: string;
  label: string;
}

export interface FootnoteRefToken {
  type: 'footnoteRef';
  raw: string;
  id: string;
}

export interface FootnoteDefToken {
  type: 'footnoteDef';
  raw: string;
  id: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface DialectSession {
  extensions: Array<
    | {
        name: 'wikiLink';
        level: 'inline';
        start: (src: string) => number;
        tokenizer: (src: string) => WikiToken | undefined;
        renderer: (token: WikiToken) => string;
      }
    | {
        name: 'footnoteRef';
        level: 'inline';
        start: (src: string) => number;
        tokenizer: (src: string) => FootnoteRefToken | undefined;
        renderer: (token: FootnoteRefToken) => string;
      }
    | {
        name: 'footnoteDef';
        level: 'block';
        start: (src: string) => number;
        tokenizer: (src: string) => FootnoteDefToken | undefined;
        renderer: (token: FootnoteDefToken) => string;
      }
  >;
  /** Footnote section HTML to append after `marked.parse`, or '' if none. */
  takeFootnoteSection: () => string;
}

export function createDialectSession(): DialectSession {
  /** footnote id → 1-based display number, assigned by first reference. */
  const numbers = new Map<string, number>();
  /** footnote id → definition text. */
  const definitions = new Map<string, string>();

  function numberFor(id: string): number {
    let n = numbers.get(id);
    if (n === undefined) {
      n = numbers.size + 1;
      numbers.set(id, n);
    }
    return n;
  }

  return {
    extensions: [
      {
        name: 'wikiLink',
        level: 'inline',
        start(src: string) {
          return src.indexOf('[[');
        },
        tokenizer(src: string) {
          const match = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
          if (!match) return undefined;
          return {
            type: 'wikiLink',
            raw: match[0],
            target: match[1].trim(),
            label: (match[2] ?? match[1]).trim(),
          };
        },
        renderer(token) {
          return `<a class="wiki-link" data-wiki-target="${escapeHtml(token.target)}" href="#">${escapeHtml(token.label)}</a>`;
        },
      },
      {
        name: 'footnoteRef',
        level: 'inline',
        start(src: string) {
          const idx = src.indexOf('[^');
          return idx === -1 ? Infinity : idx;
        },
        tokenizer(src: string) {
          const match = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
          if (!match) return undefined;
          return { type: 'footnoteRef', raw: match[0], id: match[1] };
        },
        renderer(token) {
          const n = numberFor(token.id);
          return `<sup class="footnote-ref" id="fnref-${escapeHtml(token.id)}"><a href="#fn-${escapeHtml(token.id)}">${n}</a></sup>`;
        },
      },
      {
        name: 'footnoteDef',
        level: 'block',
        start(src: string) {
          const idx = src.indexOf('[^');
          return idx === -1 ? Infinity : idx;
        },
        tokenizer(src: string) {
          // Single-line definition; leading up to 3 spaces allowed.
          const match = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]+(.*)\n?/.exec(src);
          if (!match) return undefined;
          return {
            type: 'footnoteDef',
            raw: match[0],
            id: match[1],
            text: match[2],
          };
        },
        renderer(token) {
          definitions.set(token.id, token.text);
          numberFor(token.id);
          return ''; // section is emitted at the end via takeFootnoteSection
        },
      },
    ],
    takeFootnoteSection() {
      if (definitions.size === 0) return '';
      const items = Array.from(numbers.entries())
        .filter(([id]) => definitions.has(id))
        .sort((a, b) => a[1] - b[1])
        .map(
          ([id]) =>
            `<li id="fn-${escapeHtml(id)}"><p>${escapeHtml(definitions.get(id) ?? '')} <a class="footnote-backref" href="#fnref-${escapeHtml(id)}">↩︎</a></p></li>`
        )
        .join('\n');
      return `<section class="footnotes"><hr>\n<ol>\n${items}\n</ol>\n</section>\n`;
    },
  };
}
