import { marked } from 'marked';

const DEFAULT_TITLE = '无标题笔记';
const MAX_TITLE_LENGTH = 80;

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/g, '$1')
    .trim();
}

export function deriveNoteTitle(content: string, fallback = DEFAULT_TITLE): string {
  const tokens = marked.lexer(content, { gfm: true });
  const firstTextBlock = tokens.find((token) =>
    token.type === 'heading' || token.type === 'paragraph' || token.type === 'text'
  );

  if (!firstTextBlock || !('text' in firstTextBlock)) return fallback;

  const firstLine = firstTextBlock.text.split(/\r?\n/, 1)[0] ?? '';
  const title = cleanInlineMarkdown(firstLine);
  if (!title) return fallback;

  const characters = Array.from(title);
  return characters.length > MAX_TITLE_LENGTH
    ? `${characters.slice(0, MAX_TITLE_LENGTH - 1).join('')}…`
    : title;
}

export function countMarkdownCharacters(content: string): number {
  if (!content.trim()) return 0;

  const html = marked.parse(content, { gfm: true }) as string;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());

  const visibleText = (doc.body.textContent ?? '')
    .replace(/\$\$/g, '')
    .replace(/(^|[^\\])\$/g, '$1')
    .replace(/\\[()[\]]/g, '')
    .normalize('NFC')
    .replace(/\s/gu, '');

  return Array.from(visibleText).length;
}
