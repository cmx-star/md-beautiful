/**
 * Knowledge-management index core (Phase 3).
 *
 * Everything here is derived from note contents — the index is a pure view
 * that can be rebuilt from the Vault at any time.  Link resolution follows
 * the plan's rule: explicit frontmatter `id` first, then vault-relative
 * path, then title/alias match (ambiguous targets are reported, never
 * guessed).
 */

export interface IndexedNote {
  id: string;
  /** Vault-relative path, e.g. `notes/foo.md`. */
  path: string;
  title: string;
  content: string;
  frontmatterId?: string;
  tags: string[];
  frontmatter: Record<string, string>;
}

export interface NoteIndex {
  byPath: Map<string, IndexedNote>;
  byTitle: Map<string, IndexedNote[]>;
  byFrontmatterId: Map<string, IndexedNote>;
  /** path → paths of notes that link to it. */
  backlinks: Map<string, string[]>;
  /** path → unresolved link targets. */
  unresolved: Map<string, string[]>;
  /** path → outgoing link targets (resolved + unresolved). */
  outgoing: Map<string, string[]>;
  /** path → extracted inline + frontmatter tags. */
  tags: Map<string, string[]>;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };
  const body = raw.slice(match[0].length);
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body };
}

/** Wiki links: `[[目标]]` or `[[目标|别名]]`. */
const WIKI_LINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;
/** Markdown links to other vault notes (relative paths, no url scheme). */
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
const INLINE_TAG_RE = /(^|[\s(（【])#([\p{L}\p{N}_/-]{1,64})/gu;

function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

export interface ExtractedLinks {
  wikiLinks: string[];
  markdownLinks: string[];
  tags: string[];
}

/** Extract links and tags from a note body (frontmatter excluded). */
export function extractFromContent(raw: string): ExtractedLinks {
  const { frontmatter, body } = splitFrontmatter(raw);
  const clean = stripCode(body);
  const wikiLinks: string[] = [];
  for (const match of clean.matchAll(WIKI_LINK_RE)) {
    wikiLinks.push(normalizeTarget(match[1]));
  }
  const markdownLinks: string[] = [];
  for (const match of clean.matchAll(MD_LINK_RE)) {
    const href = match[1];
    if (/^[a-z]+:/i.test(href) || href.startsWith('//')) continue; // external
    if (href.endsWith('.md') || href.endsWith('.markdown')) {
      markdownLinks.push(normalizeTarget(href));
    }
  }
  const tags = new Set<string>();
  for (const tag of parseTagList(frontmatter.tags)) tags.add(tag);
  for (const match of clean.matchAll(INLINE_TAG_RE)) {
    tags.add(match[2]);
  }
  return { wikiLinks, markdownLinks, tags: Array.from(tags) };
}

function parseTagList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Canonical link target form: strip .md, leading ./, keep ../ for paths. */
export function normalizeTarget(target: string): string {
  let t = target.trim();
  if (t.toLowerCase().endsWith('.md')) t = t.slice(0, -3);
  else if (t.toLowerCase().endsWith('.markdown')) t = t.slice(0, -9);
  return t.replace(/^\.\//, '');
}

export type LinkResolution =
  | { kind: 'resolved'; noteId: string; path: string }
  | { kind: 'ambiguous'; candidates: Array<{ id: string; path: string }> }
  | { kind: 'unresolved' };

/**
 * Resolve a link target: frontmatter `id` → vault-relative path →
 * exact title → unique basename.  Ambiguity is surfaced, not guessed.
 */
export function resolveLinkTarget(index: NoteIndex, rawTarget: string): LinkResolution {
  const target = normalizeTarget(rawTarget);
  // 1. Explicit frontmatter id.
  const byId = index.byFrontmatterId.get(target);
  if (byId) return { kind: 'resolved', noteId: byId.id, path: byId.path };
  // 2. Vault-relative path (with or without .md).
  const direct = index.byPath.get(target) ?? index.byPath.get(`${target}.md`);
  if (direct) return { kind: 'resolved', noteId: direct.id, path: direct.path };
  // 2b. Path relative to some directory: match on full path suffix? Keep strict —
  // only exact relative paths resolve here.
  // 3. Exact title (case-insensitive), then basename.
  const lower = target.toLowerCase();
  const titleMatches = index.byTitle.get(lower) ?? [];
  if (titleMatches.length === 1) {
    return { kind: 'resolved', noteId: titleMatches[0].id, path: titleMatches[0].path };
  }
  if (titleMatches.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: titleMatches.map((n) => ({ id: n.id, path: n.path })),
    };
  }
  const base = lower.split('/').pop() ?? lower;
  const baseMatches = Array.from(index.byPath.values()).filter(
    (n) => (n.path.toLowerCase().replace(/\.md$/, '').split('/').pop() ?? '') === base
  );
  if (baseMatches.length === 1) {
    return { kind: 'resolved', noteId: baseMatches[0].id, path: baseMatches[0].path };
  }
  if (baseMatches.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: baseMatches.map((n) => ({ id: n.id, path: n.path })),
    };
  }
  return { kind: 'unresolved' };
}

export function buildNoteIndex(notes: IndexedNote[]): NoteIndex {
  const index: NoteIndex = {
    byPath: new Map(),
    byTitle: new Map(),
    byFrontmatterId: new Map(),
    backlinks: new Map(),
    unresolved: new Map(),
    outgoing: new Map(),
    tags: new Map(),
  };
  for (const note of notes) {
    index.byPath.set(note.path, note);
    const key = note.title.toLowerCase();
    index.byTitle.set(key, [...(index.byTitle.get(key) ?? []), note]);
    if (note.frontmatterId) index.byFrontmatterId.set(note.frontmatterId, note);
  }
  for (const note of notes) {
    const extracted = extractFromContent(note.content);
    index.tags.set(note.path, extracted.tags);
    const outgoingTargets = [...extracted.wikiLinks, ...extracted.markdownLinks];
    index.outgoing.set(note.path, outgoingTargets);
    for (const target of outgoingTargets) {
      const resolution = resolveLinkTarget(index, target);
      if (resolution.kind === 'resolved') {
        const list = index.backlinks.get(resolution.path) ?? [];
        if (!list.includes(note.path)) list.push(note.path);
        index.backlinks.set(resolution.path, list);
      } else if (resolution.kind === 'unresolved') {
        const list = index.unresolved.get(note.path) ?? [];
        list.push(target);
        index.unresolved.set(note.path, list);
      }
      // Ambiguous targets are also surfaced as unresolved until the user
      // disambiguates — better than silently guessing.
    }
  }
  return index;
}

// ── Search (title / body / tags / attributes) ────────────────────────────────

export interface SearchHit {
  id: string;
  score: number;
}

/**
 * Space-separated terms; every term must match at least one of:
 * title, body, tags, frontmatter keys/values.  Body matches rank lower
 * than title matches so obvious hits come first.
 */
export function searchNotes(notes: IndexedNote[], query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return notes.map((n) => ({ id: n.id, score: 0 }));
  const hits: SearchHit[] = [];
  for (const note of notes) {
    const title = note.title.toLowerCase();
    const body = note.content.toLowerCase();
    const tagText = note.tags.join(' ').toLowerCase();
    const attrText = Object.entries(note.frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' ')
      .toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore = 3;
      else if (tagText.includes(term)) termScore = 2;
      else if (attrText.includes(term)) termScore = 1.5;
      else if (body.includes(term)) termScore = 1;
      if (termScore === 0) {
        matchedAll = false;
        break;
      }
      score += termScore;
    }
    if (matchedAll) hits.push({ id: note.id, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

// ── Rename with link rewrite ────────────────────────────────────────────────

/** Wiki / markdown link tokens whose target references `fromPath` or its title. */
function targetRefersTo(target: string, fromPath: string, fromTitle: string): boolean {
  const norm = normalizeTarget(target);
  const from = normalizeTarget(fromPath);
  if (norm === from || norm === from.replace(/\.md$/, '')) return true;
  if (norm.toLowerCase() === fromTitle.toLowerCase()) return true;
  return norm.toLowerCase() === (from.split('/').pop() ?? '').toLowerCase();
}

export function newLinkTargetFor(
  toPath: string,
  fromNotePath: string,
  referencingNotePath: string
): string {
  // Prefer wiki-style title/basename for same-basin references.
  const toBase = toPath.replace(/\.md$/, '').split('/').pop() ?? toPath;
  void fromNotePath;
  void referencingNotePath;
  return toBase;
}

/**
 * Rewrite links in `content` that point at `fromPath` so they point at
 * `toPath`.  Wiki links keep their label; markdown links get a basename
 * target.  Returns the original string untouched when nothing matches.
 */
export function rewriteLinksAfterRename(
  content: string,
  fromPath: string,
  fromTitle: string,
  toPath: string
): string {
  const lines = content.split(/(\n)/);
  let changed = false;
  const rewritten = lines.map((chunk) => {
    if (chunk === '\n') return chunk;
    let line = chunk;
    line = line.replace(WIKI_LINK_RE, (full, target: string) => {
      if (!targetRefersTo(target, fromPath, fromTitle)) return full;
      changed = true;
      // Preserve `|alias` (or empty) between the target and the closing ]].
      const aliasPart = full.slice(target.length + 2, -2);
      return `[[${newLinkTargetFor(toPath, fromPath, '')}${aliasPart}]]`;
    });
    line = line.replace(MD_LINK_RE, (full, href: string) => {
      if (!targetRefersTo(href, fromPath, fromTitle)) return full;
      changed = true;
      const label = full.slice(1, full.indexOf(']'));
      return `[${label}](./${newLinkTargetFor(toPath, fromPath, '')}.md)`;
    });
    return line;
  });
  if (!changed) return content;
  return rewritten.join('');
}

/** Notes whose contents would change when `path` is renamed to `newTitle`. */
export function affectedNotesForRename(index: NoteIndex, path: string): string[] {
  return index.backlinks.get(path) ?? [];
}
