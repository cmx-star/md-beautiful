/**
 * Migration service — moves Pinia note bodies from `localStorage` to the
 * user-chosen Vault as real `.md` files.
 *
 * The service is intentionally pure-data: every filesystem call is injected
 * via the `VaultAdapter` interface so the orchestration logic can be unit
 * tested under jsdom without the Tauri runtime.
 */

import {
  buildNoteFile,
  type FrontmatterDoc,
} from '@/utils/frontmatter';
import { candidateFileName, withCollisionSuffix } from '@/utils/slugify';

const LEGACY_KEY = 'mardown-beautiful-notes';
const SCHEMA_VERSION = 1;

export interface MigrationNote {
  id: string;
  title: string;
  content: string;
  folderId?: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  isFavorite: boolean;
}

export interface VaultFileEntry {
  path: string;
  name: string;
}

export interface VaultAdapter {
  /** List the relative file entries already present under `imported/` in the Vault. */
  listImported(): Promise<VaultFileEntry[]>;
  /** Atomically write a file. Throws on validation failure. */
  writeFile(relativePath: string, content: string): Promise<void>;
  /** Read a file by relative path. */
  readFile(relativePath: string): Promise<string>;
  /** Move a file to a new path; both must stay within the Vault. */
  moveFile(relativePath: string, newRelativePath: string): Promise<void>;
  /** Read the existing log, or return null when none exists. */
  readLog(): Promise<MigrationLog | null>;
  /** Write the log; overwrites any prior content. */
  writeLog(log: MigrationLog): Promise<void>;
}

export interface MigrationLogEntry {
  at: number;
  action: 'migrate' | 'revert' | 'rollback-failed';
  snapshotFile: string | null;
  importedCount: number;
  details?: Record<string, unknown>;
}

export interface MigrationLog {
  schemaVersion: number;
  entries: MigrationLogEntry[];
}

export interface MigrationResult {
  snapshotFile: string;
  imported: Array<{ noteId: string; path: string }>;
  failed: Array<{ noteId: string; error: string }>;
  clearedLocalStorage: boolean;
}

export class MigrationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'MigrationError';
  }
}

function readLegacyNotes(): MigrationNote[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MigrationNote =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.title === 'string' &&
        typeof entry.content === 'string'
    );
  } catch {
    return [];
  }
}

function buildFrontmatter(note: MigrationNote): FrontmatterDoc {
  return {
    id: note.id,
    title: note.title,
    tags: Array.isArray(note.tags) ? note.tags : [],
    folderId: note.folderId ?? null,
    createdAt: note.createdAt || Date.now(),
    updatedAt: note.updatedAt || note.createdAt || Date.now(),
    wordCount: note.wordCount || 0,
    isFavorite: Boolean(note.isFavorite),
  };
}

function pickPath(
  title: string,
  usedNames: Set<string>
): string {
  const base = candidateFileName(title);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  for (let attempt = 1; attempt < 10_000; attempt++) {
    const candidate = withCollisionSuffix(base, attempt);
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  // Pathological case: extremely unlikely.  Use timestamp suffix.
  const ts = Date.now();
  const fallback = withCollisionSuffix(base, ts);
  usedNames.add(fallback);
  return fallback;
}

function makeSnapshotFileName(now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, '-');
  return `.migration-backup-${iso}.json`;
}

/**
 * Run the migration.  The caller must guarantee a Vault is already open and
 * the adapter is bound to that Vault.
 *
 * On any unexpected error, the localStorage key is **not** cleared so the
 * caller can retry safely.
 */
export async function runMigration(
  vault: VaultAdapter,
  options: { now?: () => Date; legacyKey?: string } = {}
): Promise<MigrationResult> {
  const now = options.now ?? (() => new Date());
  const legacyKey = options.legacyKey ?? LEGACY_KEY;

  const notes = readLegacyNotes();
  if (notes.length === 0) {
    return {
      snapshotFile: '',
      imported: [],
      failed: [],
      clearedLocalStorage: false,
    };
  }

  const snapshotFile = makeSnapshotFileName(now());
  const snapshotPayload = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: now().getTime(),
    notes,
  };

  // Phase 1: write snapshot before touching imported/ — if this fails the
  // localStorage copy is intact and the user can retry.
  await vault.writeFile(
    snapshotFile,
    JSON.stringify(snapshotPayload, null, 2)
  );

  // Phase 2: enumerate what's already in imported/ so we don't overwrite.
  const existing = await vault.listImported();
  const usedNames = new Set(existing.map((entry) => entry.name));

  const imported: MigrationResult['imported'] = [];
  const failed: MigrationResult['failed'] = [];

  for (const note of notes) {
    try {
      const fileName = pickPath(note.title, usedNames);
      const relativePath = `imported/${fileName}`;
      const frontmatter = buildFrontmatter(note);
      const fileBody = buildNoteFile(frontmatter, note.content);
      await vault.writeFile(relativePath, fileBody);
      imported.push({ noteId: note.id, path: relativePath });
    } catch (error) {
      failed.push({
        noteId: note.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Phase 3: clear localStorage *only* if every file was written, otherwise
  // the caller can fall back to keeping the legacy copy intact and still
  // benefit from the partial export.  Behaviour is opt-out via the function
  // flag below for tests.
  if (failed.length === 0) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(legacyKey);
    }
  }

  const priorLog = (await vault.readLog()) ?? {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
  };
  const entry: MigrationLogEntry = {
    at: now().getTime(),
    action: 'migrate',
    snapshotFile,
    importedCount: imported.length,
    details: { failed: failed.length },
  };
  const nextLog: MigrationLog = {
    schemaVersion: SCHEMA_VERSION,
    entries: [...priorLog.entries, entry],
  };
  await vault.writeLog(nextLog);

  return {
    snapshotFile,
    imported,
    failed,
    clearedLocalStorage: failed.length === 0,
  };
}

export interface RevertResult {
  revertedNotes: number;
  movedTo: string;
}

/**
 * Move every file currently under `imported/` to a new `.reverted-<iso>/`
 * subdirectory and write the original localStorage payload back.  This is
 * the inverse of `runMigration` and is exposed to the settings UI.
 */
export async function revertMigration(
  vault: VaultAdapter,
  snapshotFile: string,
  options: { now?: () => Date } = {}
): Promise<RevertResult> {
  const now = options.now ?? (() => new Date());
  let parsed: { notes: MigrationNote[] };
  try {
    const snapshotRaw = await vault.readFile(snapshotFile);
    try {
      parsed = JSON.parse(snapshotRaw);
    } catch (error) {
      throw new MigrationError(
        `快照文件 ${snapshotFile} 不是合法 JSON`,
        error
      );
    }
    if (!parsed || !Array.isArray(parsed.notes)) {
      throw new MigrationError(`快照文件 ${snapshotFile} 缺少 notes 字段`);
    }
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError(
      `无法读取快照 ${snapshotFile}：${
        error instanceof Error ? error.message : String(error)
      }`,
      error
    );
  }

  const targetDir = `imported/.reverted-${now().toISOString().replace(/[:.]/g, '-')}`;
  const existing = await vault.listImported();
  const importedEntries = existing.filter(
    (entry) => !entry.path.includes('/.reverted-')
  );

  for (const entry of importedEntries) {
    const target = `${targetDir}/${entry.name}`;
    await vault.moveFile(entry.path, target);
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(parsed.notes));
  }

  const priorLog = (await vault.readLog()) ?? {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
  };
  const logEntry: MigrationLogEntry = {
    at: now().getTime(),
    action: 'revert',
    snapshotFile,
    importedCount: importedEntries.length,
  };
  await vault.writeLog({
    schemaVersion: SCHEMA_VERSION,
    entries: [...priorLog.entries, logEntry],
  });

  return {
    revertedNotes: parsed.notes.length,
    movedTo: targetDir,
  };
}

export async function listMigrationSnapshots(
  vault: VaultAdapter
): Promise<Array<{ file: string; capturedAt: number }>> {
  const log = await vault.readLog();
  if (!log) return [];
  return log.entries
    .filter((entry) => entry.action === 'migrate' && entry.snapshotFile)
    .map((entry) => ({
      file: entry.snapshotFile!,
      capturedAt: entry.at,
    }));
}

// (no module augmentation needed; readFile is part of VaultAdapter)
