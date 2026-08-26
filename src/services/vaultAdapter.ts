/**
 * Bridge between the typed `VaultAdapter` interface used by
 * `migrationService` and the Tauri-backed `vaultService` calls.
 *
 * The adapter is created only after the user has opened a Vault; the
 * migration service must not run before that.
 */

import { vaultService, type FileInfo, type FileFingerprint } from './vaultService';
import type { MigrationLog, VaultAdapter } from './migrationService';

const MIGRATION_LOG_PATH = '.migration-log.json';

function relativeFromListEntry(entry: FileInfo): { path: string; name: string } {
  return { path: entry.path, name: entry.name };
}

export function createTauriVaultAdapter(): VaultAdapter {
  return {
    async listImported() {
      const files = await vaultService.listFiles();
      return files
        .filter((entry) => !entry.is_directory)
        .filter((entry) =>
          entry.path === '.migration-log.json' ||
          entry.path.startsWith('.migration-backup-') ||
          entry.path.startsWith('imported/')
        )
        .map(relativeFromListEntry);
    },
    async writeFile(relativePath, content) {
      const result: FileFingerprint = await vaultService.writeFile(
        relativePath,
        content
      );
      if (!result) throw new Error(`写入失败: ${relativePath}`);
    },
    async readFile(relativePath) {
      return vaultService.readFile(relativePath);
    },
    async moveFile(from, to) {
      await vaultService.renameFile(from, to);
    },
    async readLog() {
      try {
        const raw = await vaultService.readFile(MIGRATION_LOG_PATH);
        return JSON.parse(raw) as MigrationLog;
      } catch (error) {
        // Treat any read failure as "no log" so the first migration
        // doesn't surface a confusing error to the user.
        return null;
      }
    },
    async writeLog(log) {
      await vaultService.writeFile(
        MIGRATION_LOG_PATH,
        JSON.stringify(log, null, 2)
      );
    },
  };
}
