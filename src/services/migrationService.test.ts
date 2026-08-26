import { describe, it, expect, beforeEach } from 'vitest';
import {
  runMigration,
  revertMigration,
  listMigrationSnapshots,
  MigrationError,
  type MigrationNote,
  type VaultAdapter,
  type MigrationLog,
} from './migrationService';

const LEGACY_KEY = 'mardown-beautiful-notes';

class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  log: MigrationLog | null = null;
  moved: Array<{ from: string; to: string }> = [];

  async listImported(): Promise<Array<{ path: string; name: string }>> {
    return Array.from(this.files.keys())
      .filter((p) => p.startsWith('imported/') && !p.includes('/.reverted-'))
      .map((p) => {
        const lastSlash = p.lastIndexOf('/');
        return {
          path: p,
          name: lastSlash >= 0 ? p.slice(lastSlash + 1) : p,
        };
      });
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`not found: ${path}`);
    return value;
  }

  async moveFile(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value === undefined) throw new Error(`not found: ${from}`);
    this.files.delete(from);
    this.files.set(to, value);
    this.moved.push({ from, to });
  }

  async readLog(): Promise<MigrationLog | null> {
    return this.log;
  }

  async writeLog(log: MigrationLog): Promise<void> {
    this.log = log;
  }
}

function note(over: Partial<MigrationNote> = {}): MigrationNote {
  return {
    id: 'id-' + Math.random().toString(36).slice(2, 8),
    title: 'Untitled',
    content: '# body',
    folderId: null,
    tags: [],
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    wordCount: 1,
    isFavorite: false,
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('runMigration', () => {
  it('returns empty result when no legacy notes exist', async () => {
    const vault = new MemoryVault();
    const result = await runMigration(vault);
    expect(result.imported).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.clearedLocalStorage).toBe(false);
  });

  it('writes one file per note under imported/ and clears the localStorage key', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([note({ title: 'First' }), note({ title: 'Second' })])
    );
    const vault = new MemoryVault();
    const result = await runMigration(vault, { now: () => new Date('2026-08-26T01:02:03.004Z') });

    expect(result.imported).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.clearedLocalStorage).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    const snapshotKey = Array.from(vault.files.keys()).find((k) => k.startsWith('.migration-backup-'));
    expect(snapshotKey).toBeDefined();
    const snapshot = JSON.parse(vault.files.get(snapshotKey!)!);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.notes).toHaveLength(2);

    const importedFiles = Array.from(vault.files.keys()).filter((k) =>
      k.startsWith('imported/')
    );
    expect(importedFiles).toHaveLength(2);
    expect(importedFiles.every((p) => p.endsWith('.md'))).toBe(true);
  });

  it('appends -N to filenames when titles collide', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        note({ id: 'a', title: 'Same' }),
        note({ id: 'b', title: 'Same' }),
        note({ id: 'c', title: 'Same' }),
      ])
    );
    const vault = new MemoryVault();
    const result = await runMigration(vault);

    const names = result.imported.map((i) => i.path);
    expect(names).toContain('imported/Same.md');
    expect(names).toContain('imported/Same-1.md');
    expect(names).toContain('imported/Same-2.md');
  });

  it('respects files already in imported/ as the collision baseline', async () => {
    const vault = new MemoryVault();
    vault.files.set('imported/Hello.md', 'pre-existing');
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([note({ title: 'Hello' })])
    );
    const result = await runMigration(vault);
    expect(result.imported[0].path).toBe('imported/Hello-1.md');
  });

  it('does not clear localStorage when any file write fails', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([note({ id: 'a', title: 'A' }), note({ id: 'b', title: 'B' })])
    );
    const vault = new MemoryVault();
    const real = vault.writeFile.bind(vault);
    vault.writeFile = async (path, content) => {
      if (path.includes('B.md')) throw new Error('disk full');
      return real(path, content);
    };
    const result = await runMigration(vault);
    expect(result.imported).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.clearedLocalStorage).toBe(false);
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('records a migrate log entry with the snapshot path', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([note()]));
    const vault = new MemoryVault();
    const result = await runMigration(vault, {
      now: () => new Date('2026-08-26T01:02:03.004Z'),
    });
    expect(vault.log?.entries).toHaveLength(1);
    const entry = vault.log!.entries[0];
    expect(entry.action).toBe('migrate');
    expect(entry.snapshotFile).toBe(result.snapshotFile);
    expect(entry.importedCount).toBe(1);
  });
});

describe('revertMigration', () => {
  it('moves every imported file into a .reverted-<iso>/ subdir and writes notes back to localStorage', async () => {
    const notes = [note({ id: 'x', title: 'X' }), note({ id: 'y', title: 'Y' })];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(notes));
    const vault = new MemoryVault();
    const migrateResult = await runMigration(vault, {
      now: () => new Date('2026-08-26T01:02:03.004Z'),
    });

    // Simulate the user already cleared the legacy key (post-migration).
    localStorage.removeItem(LEGACY_KEY);

    const revert = await revertMigration(vault, migrateResult.snapshotFile, {
      now: () => new Date('2026-08-26T05:00:00.000Z'),
    });

    expect(revert.revertedNotes).toBe(2);
    expect(revert.movedTo).toMatch(/^imported\/.reverted-/);
    expect(vault.moved).toHaveLength(2);
    const restored = JSON.parse(localStorage.getItem(LEGACY_KEY)!);
    expect(restored).toHaveLength(2);
    expect(restored.map((n: MigrationNote) => n.id).sort()).toEqual(['x', 'y']);
  });

  it('throws MigrationError when the snapshot is missing or invalid', async () => {
    const vault = new MemoryVault();
    vault.files.set('imported/A.md', 'body');
    await expect(revertMigration(vault, 'missing.json')).rejects.toBeInstanceOf(
      MigrationError
    );
  });

  it('appends a revert log entry', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([note()]));
    const vault = new MemoryVault();
    const migrateResult = await runMigration(vault);
    await revertMigration(vault, migrateResult.snapshotFile);
    const last = vault.log!.entries[vault.log!.entries.length - 1];
    expect(last.action).toBe('revert');
    expect(last.snapshotFile).toBe(migrateResult.snapshotFile);
  });
});

describe('listMigrationSnapshots', () => {
  it('returns snapshot entries in chronological order', async () => {
    const vault = new MemoryVault();
    localStorage.setItem(LEGACY_KEY, JSON.stringify([note()]));
    const r1 = await runMigration(vault, {
      now: () => new Date('2026-08-26T01:00:00.000Z'),
    });
    localStorage.setItem(LEGACY_KEY, JSON.stringify([note()]));
    const r2 = await runMigration(vault, {
      now: () => new Date('2026-08-26T02:00:00.000Z'),
    });
    const list = await listMigrationSnapshots(vault);
    expect(list.map((s) => s.file)).toEqual([r1.snapshotFile, r2.snapshotFile]);
  });

  it('returns [] when no log exists', async () => {
    const vault = new MemoryVault();
    expect(await listMigrationSnapshots(vault)).toEqual([]);
  });
});
