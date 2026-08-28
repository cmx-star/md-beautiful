/**
 * Pure text-transform core for the CodeMirror markdown commands (Phase 2).
 *
 * Every command is expressed as plain string → string transforms so the
 * rules are unit-testable without an editor.  The CodeMirror layer in
 * `editorCommands.ts` maps these onto ranges and multi-line selections.
 */

export interface LineParts {
  indent: string;
  prefix: string;
  content: string;
}

const PREFIX_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^(\s*)(#{1,6}\s+)/, (m) => m[2]],
  [/^(\s*)(>\s?)/, (m) => m[2]],
  [/^(\s*)([-*+]\s\[[ xX]\]\s)/, (m) => m[2]],
  [/^(\s*)(\d+\.\s)/, (m) => m[2]],
  [/^(\s*)([-*+]\s)/, (m) => m[2]],
];

/** Split a line into indentation, markdown prefix (if any), and content. */
export function splitLinePrefix(line: string): LineParts {
  for (const [pattern, extract] of PREFIX_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      return {
        indent: match[1],
        prefix: extract(match),
        content: line.slice(match[0].length),
      };
    }
  }
  const indentMatch = line.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  return { indent, prefix: '', content: line.slice(indent.length) };
}

/**
 * Toggle `prefix` on a single line: applying it to a line that already
 * carries the same prefix removes the prefix; otherwise it (re)applies it.
 */
export function toggleLinePrefix(line: string, prefix: string): string {
  const { indent, prefix: current, content } = splitLinePrefix(line);
  if (current === prefix) return indent + content;
  return indent + prefix + content;
}

/** Toggle a heading level on a line (clicking the active level clears it). */
export function toggleHeading(line: string, level: number): string {
  const headingMatch = line.match(/^(\s*)(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const [, indent, hashes, rest] = headingMatch;
    if (hashes.length === level) {
      return indent + rest;
    }
    return indent + '#'.repeat(level) + ' ' + rest;
  }
  const { indent, prefix, content } = splitLinePrefix(line);
  return indent + prefix + '#'.repeat(level) + ' ' + content;
}

/** Toggle a task checkbox prefix between `- [ ]` and `- [x]`. */
export function toggleTaskDone(line: string): string {
  const { indent, prefix, content } = splitLinePrefix(line);
  if (prefix === '- [x] ' || prefix === '- [X] ') {
    return `${indent}- [ ] ${content}`;
  }
  if (prefix === '- [ ] ') {
    return `${indent}- [x] ${content}`;
  }
  return `${indent}- [ ] ${content}`;
}

/** Toggle bullet list prefix. */
export function toggleBulletList(line: string): string {
  return toggleLinePrefix(line, '- ');
}

/** Toggle ordered list numbering prefix. */
export function toggleNumberedList(line: string): string {
  return toggleLinePrefix(line, '1. ');
}

/** Toggle block quote prefix. */
export function toggleBlockQuote(line: string): string {
  return toggleLinePrefix(line, '> ');
}

/** Wrap / unwrap `marker` around the selected text (bold, italic, code…). */
export interface WrapTransform {
  insert: string;
  selectionStart: number;
  selectionEnd: number;
}

export function toggleWrap(selected: string, marker: string): WrapTransform {
  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { insert: inner, selectionStart: 0, selectionEnd: inner.length };
  }
  const body = selected || '文本';
  return {
    insert: marker + body + marker,
    selectionStart: marker.length,
    selectionEnd: marker.length + body.length,
  };
}

/** Toggle `[label](url)` around the selection. */
export function toggleLink(selected: string): WrapTransform {
  if (/^\[[^\]]*\]\([^)]*\)$/.test(selected)) {
    const label = selected.slice(1, selected.indexOf(']'));
    return { insert: label, selectionStart: 0, selectionEnd: label.length };
  }
  const label = selected || '链接';
  const insert = `[${label}](url)`;
  return {
    insert,
    selectionStart: label.length + 3,
    selectionEnd: insert.length - 1,
  };
}

export const EMPTY_TABLE = [
  '| 列1 | 列2 | 列3 |',
  '| --- | --- | --- |',
  '|  |  |  |',
].join('\n');

export function mathBlock(display: boolean): string {
  return display ? '$$\n公式\n$$' : '$公式$';
}

export function codeBlock(language = ''): string {
  return '```' + language + '\n\n```\n';
}
