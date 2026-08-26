/**
 * Tiny YAML frontmatter serializer for the migration format.
 *
 * The serializer intentionally only supports the field shapes used by the
 * existing `Note` type: strings, optional strings, numbers, booleans, and
 * string arrays.  It is *not* a general-purpose YAML library; on malformed
 * input the parser returns `null` so callers can fall back to treating the
 * file as plain markdown.
 *
 * Format:
 *
 *   ---
 *   id: <string>
 *   title: <string>
 *   tags: [a, b, c]
 *   folder_id: <id>      # omitted when null
 *   created_at: 1234
 *   updated_at: 1234
 *   word_count: 0
 *   is_favorite: false
 *   ---
 *   <body>
 */

export interface FrontmatterDoc {
  id: string;
  title: string;
  tags: string[];
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  isFavorite: boolean;
}

const HEADER = '---';
const NL = '\n';

function escapeScalar(value: string): string {
  if (value === '' || /[:#&*!|>'"%@`{}\[\],\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function renderValue(value: unknown, indent: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return escapeScalar(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (typeof item === 'string') return escapeScalar(item);
      if (typeof item === 'number' || typeof item === 'boolean') return String(item);
      return escapeScalar(String(item));
    });
    return `[${items.join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => `${indent}  ${escapeScalar(k)}: ${renderValue(v, indent + '  ')}`)
      .join('\n');
  }
  return String(value);
}

const FIELD_ORDER: Array<[keyof FrontmatterDoc, string]> = [
  ['id', 'id'],
  ['title', 'title'],
  ['tags', 'tags'],
  ['folderId', 'folder_id'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
  ['wordCount', 'word_count'],
  ['isFavorite', 'is_favorite'],
];

export function serializeFrontmatter(doc: FrontmatterDoc): string {
  const lines: string[] = [HEADER];
  for (const [key, label] of FIELD_ORDER) {
    const value = doc[key];
    if (key === 'folderId' && (value === null || value === undefined)) continue;
    lines.push(`${label}: ${renderValue(value, '')}`);
  }
  lines.push(HEADER);
  return lines.join(NL);
}

export interface NoteFile {
  frontmatter: FrontmatterDoc;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(raw: string): NoteFile | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  const block = match[1];
  const body = raw.slice(match[0].length);

  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) return null;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }

  const required = ['id', 'title', 'created_at', 'updated_at', 'word_count', 'is_favorite'];
  for (const k of required) if (!(k in fields)) return null;
  if (!('tags' in fields)) return null;

  const tagsRaw = fields.tags;
  const tags = tagsRaw.startsWith('[') && tagsRaw.endsWith(']')
    ? tagsRaw
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s))
    : tagsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  return {
    frontmatter: {
      id: fields.id,
      title: fields.title,
      tags,
      folderId: fields.folder_id ?? null,
      createdAt: Number(fields.created_at) || 0,
      updatedAt: Number(fields.updated_at) || 0,
      wordCount: Number(fields.word_count) || 0,
      isFavorite: fields.is_favorite === 'true',
    },
    body,
  };
}

export function buildNoteFile(doc: FrontmatterDoc, body: string): string {
  const head = serializeFrontmatter(doc);
  if (body.length === 0) return head + NL;
  return `${head}${NL}${body}`;
}
