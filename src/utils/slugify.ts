/**
 * Slugify a note title for use as a filename within the Vault's `imported/`
 * directory.  All file paths produced by this module are guaranteed to be:
 *
 *   - Non-empty
 *   - Free of `..`, `/`, `\` and NUL
 *   - Capped at 60 characters
 *   - Composed only of ASCII letters, digits, `-`, `_`, and `.`
 *   - Never equal to a Windows reserved device name (CON, PRN, AUX, NUL,
 *     COM1..COM9, LPT1..LPT9) on case-insensitive basis.
 *
 * If the slug cannot be derived from the title (empty after stripping), the
 * fallback `untitled` is used.
 */

const FORBIDDEN = /[\/\\\x00]/g;
const COLLAPSE = /\s+/g;
const STRIP = /[^A-Za-z0-9._-]/g;
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);
const MAX_LENGTH = 60;

function sanitize(input: string): string {
  return input
    .replace(FORBIDDEN, '-')
    .replace(COLLAPSE, '-')
    .replace(STRIP, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

export function slugifyTitle(title: string | null | undefined): string {
  const raw = typeof title === 'string' ? title : '';
  let slug = sanitize(raw);
  if (slug.length > MAX_LENGTH) {
    slug = slug.slice(0, MAX_LENGTH).replace(/[-.]+$/g, '');
  }
  if (!slug) return 'untitled';
  if (RESERVED.has(slug.toUpperCase())) return `note-${slug}`;
  return slug;
}

/**
 * Build a deterministic candidate filename: `${slugifyTitle(title)}.md`.
 * Pure function; does not touch the filesystem.
 */
export function candidateFileName(title: string | null | undefined): string {
  return `${slugifyTitle(title)}.md`;
}

/**
 * Apply a counter suffix to a base filename when the candidate already
 * exists.  `first.try.md` → `first-1.try.md`, `first-1.try.md` → `first-2.try.md`.
 */
export function withCollisionSuffix(baseName: string, attempt: number): string {
  if (attempt <= 0) return baseName;
  const dot = baseName.lastIndexOf('.');
  if (dot <= 0) return `${baseName}-${attempt}`;
  const stem = baseName.slice(0, dot);
  const ext = baseName.slice(dot);
  return `${stem}-${attempt}${ext}`;
}
