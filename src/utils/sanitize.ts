/**
 * Markdown 预览 HTML 白名单清洗器
 *
 * 目标：仅允许安全的 HTML 标签与属性，禁止脚本、事件处理器和危险 URL。
 * 用于替代 `innerHTML` 直接写入，防止恶意 Markdown 注入。
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'strong', 'em', 'del', 'ins', 'mark', 'small',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'section',
  'input',
  'sup', 'sub',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title',
  'class', 'id',
  'type', 'checked', 'disabled', 'value',
  'colspan', 'rowspan',
  'width', 'height',
  'start', 'reversed', 'value',
  'cite',
]);

const DANGEROUS_URL_RE = /^\s*(javascript:|data:|vbscript:|file:)/i;

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (DANGEROUS_URL_RE.test(trimmed)) return false;
  // Allow relative paths and safe protocols
  if (/^(https?:|\/\/|\/|#|mailto:|tel:)/i.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return true;
  if (trimmed.startsWith('#')) return true;
  // Block anything else
  return false;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeAttributes(attrs: NamedNodeMap): string {
  const parts: string[] = [];
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs.item(i)!;
    const name = attr.name.toLowerCase();
    // data-* attributes are inert and needed for wiki-link click targets.
    const allowed = ALLOWED_ATTRS.has(name) || name.startsWith('data-');
    if (!allowed) continue;
    // Strip event handler attributes (on*)
    if (name.startsWith('on')) continue;
    let value = attr.value;
    if (name === 'href' || name === 'src' || name === 'cite') {
      if (!isSafeUrl(value)) continue;
    }
    parts.push(`${name}="${escapeText(value)}"`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function sanitizeNode(node: Node, doc: Document): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'style' || tag === 'script' || tag === 'noscript' || tag === 'iframe') {
    return '';
  }

  if (!ALLOWED_TAGS.has(tag)) {
    // Flatten allowed children
    let out = '';
    for (const child of Array.from(el.childNodes)) {
      out += sanitizeNode(child, doc);
    }
    return out;
  }

  const attrs = sanitizeAttributes(el.attributes);
  let open = `<${tag}${attrs}>`;
  let close = `</${tag}>`;

  // Self-closing tags
  if (tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'input') {
    return `<${tag}${attrs}>`;
  }

  let inner = '';
  for (const child of Array.from(el.childNodes)) {
    inner += sanitizeNode(child, doc);
  }
  return open + inner + close;
}

/**
 * 对 HTML 字符串执行白名单清洗，返回安全的 HTML。
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  let out = '';
  for (const child of Array.from(doc.body.childNodes)) {
    out += sanitizeNode(child, document);
  }
  return out;
}

export default sanitizeHtml;