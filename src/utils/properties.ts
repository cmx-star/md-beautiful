/**
 * Frontmatter property panel support (Phase 2).
 *
 * Unlike `frontmatter.ts` (the strict migration serializer), this module
 * treats frontmatter as an ordered list of raw `key: value` lines so that
 * unknown fields survive edits byte-for-byte.  Values are kept as raw YAML
 * scalars; minimal quoting is applied only when the value would otherwise
 * be invalid.
 */

export interface FrontmatterField {
  key: string;
  /** Raw scalar text after `key: ` (quotes stripped on parse). */
  value: string;
  /** The original `key: value` line, preserved verbatim for untouched fields. */
  rawLine: string;
  /** Unknown fields are preserved verbatim on serialize. */
  known: boolean;
}

export interface ParsedProperties {
  hasFrontmatter: boolean;
  fields: FrontmatterField[];
  body: string;
}

export const KNOWN_PROPERTY_KEYS = new Set([
  'id',
  'title',
  'tags',
  'folder_id',
  'created_at',
  'updated_at',
  'word_count',
  'is_favorite',
]);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseProperties(raw: string): ParsedProperties {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { hasFrontmatter: false, fields: [], body: raw };
  }
  const block = match[1];
  const body = raw.slice(match[0].length);
  const fields: FrontmatterField[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue; // malformed lines are dropped from the panel view
    const key = line.slice(0, idx).trim();
    const value = unquote(line.slice(idx + 1).trim());
    fields.push({
      key,
      value,
      rawLine: line,
      known: KNOWN_PROPERTY_KEYS.has(key),
    });
  }
  return { hasFrontmatter: true, fields, body };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

function quoteIfNeeded(value: string): string {
  if (value === '') return '""';
  if (/[:#&*!|>'"%@`{}[\],]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

export interface PropertyEdit {
  key: string;
  value: string;
}

/**
 * Rebuild the document from the complete desired property list.  Fields
 * whose value is unchanged keep their original line byte-for-byte (unknown /
 * custom syntax is never rewritten); changed keys are re-serialized; keys
 * missing from `edits` are removed; new keys append in edit order.
 */
export function applyPropertyEdits(raw: string, edits: PropertyEdit[]): string {
  if (edits.length === 0) return raw;
  const parsed = parseProperties(raw);
  const editByKey = new Map(edits.map((e) => [e.key, e]));

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const field of parsed.fields) {
    const edit = editByKey.get(field.key);
    if (!edit) continue; // user removed this key from the panel
    if (edit.value === field.value) {
      lines.push(field.rawLine);
    } else {
      lines.push(`${edit.key}: ${quoteIfNeeded(edit.value)}`);
    }
    seen.add(field.key);
  }
  for (const edit of edits) {
    if (!seen.has(edit.key)) {
      lines.push(`${edit.key}: ${quoteIfNeeded(edit.value)}`);
      seen.add(edit.key);
    }
  }

  const head = ['---', ...lines, '---'].join('\n');
  if (!parsed.hasFrontmatter) {
    return raw.length === 0 ? `${head}\n` : `${head}\n${raw}`;
  }
  return `${head}\n${parsed.body}`;
}

/** Values for the tags editor: parse `[a, b]` / `a, b` into a list. */
export function parseTagsValue(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

export function serializeTagsValue(tags: string[]): string {
  return `[${tags.map(quoteIfNeeded).join(', ')}]`;
}
