/**
 * Draft service — captures in-progress edits as localStorage entries so
 * unsaved content can be recovered after an abnormal exit.
 *
 * Drafts live under their own key (`mardown-beautiful-drafts`) and are
 * intentionally isolated from the legacy note key, the theme key, and
 * the migration log so the three subsystems never overwrite each other.
 *
 * Drafts are compared against the Vault's `FileFingerprint` to decide
 * whether the underlying file has been modified externally — in which
 * case recovery is offered but treated as a conflict.
 */

const DRAFTS_KEY = 'mardown-beautiful-drafts';

export interface DraftEntry {
  content: string;
  baseMtime: number;
  baseSize: number;
  savedAt: number;
}

export type Drafts = Record<string, DraftEntry>;

export interface DraftStore {
  read(): Drafts;
  write(drafts: Drafts): void;
}

export const localStorageDraftStore: DraftStore = {
  read() {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Drafts;
    } catch {
      return {};
    }
  },
  write(drafts: Drafts) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  },
};

export function saveDraft(
  noteId: string,
  entry: DraftEntry,
  store: DraftStore = localStorageDraftStore
): Drafts {
  const drafts = store.read();
  drafts[noteId] = entry;
  store.write(drafts);
  return drafts;
}

export function clearDraft(
  noteId: string,
  store: DraftStore = localStorageDraftStore
): Drafts {
  const drafts = store.read();
  if (noteId in drafts) {
    delete drafts[noteId];
    store.write(drafts);
  }
  return drafts;
}

export function listRecoverableDrafts(
  store: DraftStore = localStorageDraftStore,
  now: () => number = Date.now
): Array<{ noteId: string; entry: DraftEntry; ageMs: number }> {
  const drafts = store.read();
  const stamp = now();
  return Object.entries(drafts)
    .map(([noteId, entry]) => ({ noteId, entry, ageMs: stamp - entry.savedAt }))
    .sort((a, b) => b.entry.savedAt - a.entry.savedAt);
}

export type DraftConflict =
  | { kind: 'no-fingerprint' }
  | { kind: 'unchanged'; current: { mtime: number; size: number } }
  | { kind: 'modified'; current: { mtime: number; size: number } };

/**
 * Compare a stored draft to the current fingerprint of the underlying file.
 *
 * - `no-fingerprint`: no fingerprint was captured when the draft was saved.
 *   Callers should treat this as a "recover without verification" case.
 * - `unchanged`: the file on disk still matches the version the draft was
 *   based on.  Safe to recover without warnings.
 * - `modified`: the file has been touched externally.  Recovery is still
 *   possible, but the UI must surface a conflict warning.
 */
export function classifyDraft(
  entry: DraftEntry,
  current: { mtime: number; size: number } | null
): DraftConflict {
  if (current === null) return { kind: 'no-fingerprint' };
  if (current.mtime === entry.baseMtime && current.size === entry.baseSize) {
    return { kind: 'unchanged', current };
  }
  return { kind: 'modified', current };
}
