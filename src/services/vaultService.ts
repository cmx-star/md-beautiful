/**
 * Vault service — wraps Tauri IPC commands for Vault-bounded file operations.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface FileInfo {
  name: string;
  is_directory: boolean;
  path: string;
}

export interface FileFingerprint {
  path: string;
  mtime: number;
  size: number;
}

/**
 * Payload pushed by the Rust watcher via the `vault://changed` event.
 * The backend already filters migration artifacts (`.migration-backup-*`,
 * `.migration-log.json`, `imported/.reverted-*`) and suppresses events
 * caused by the app's own writes.
 */
export interface VaultChangeEvent {
  path: string;
  kind: 'created' | 'modified' | 'removed';
  at: number;
}

export const vaultService = {
  async openVault(root: string): Promise<FileInfo[]> {
    return invoke<FileInfo[]>('open_vault', { root });
  },
  async readFile(relativePath: string): Promise<string> {
    return invoke<string>('vault_read_file', { relativePath: relativePath });
  },
  async writeFile(relativePath: string, content: string): Promise<FileFingerprint> {
    return invoke<FileFingerprint>('vault_write_file', { relativePath, content });
  },
  async checkChanged(relativePath: string): Promise<boolean> {
    return invoke<boolean>('vault_check_changed', { relativePath });
  },
  async getRoot(): Promise<string | null> {
    return invoke<string | null>('vault_root');
  },
  async createNote(relativePath: string, content: string): Promise<FileFingerprint> {
    return invoke<FileFingerprint>('vault_create_note', { relativePath, content });
  },
  async deleteFile(relativePath: string): Promise<void> {
    return invoke<void>('vault_delete_file', { relativePath });
  },
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    return invoke<void>('vault_rename_file', { oldPath, newPath });
  },
  async listFiles(): Promise<FileInfo[]> {
    return invoke<FileInfo[]>('vault_list_files');
  },
  async getDataDir(): Promise<string> {
    return invoke<string>('get_data_dir');
  },
  /**
   * Close the current Vault: drops the Rust watcher, clears fingerprints
   * and the sync baseline.  Safe to call when no vault is open.
   */
  async closeVault(): Promise<void> {
    return invoke<void>('close_vault');
  },
  /**
   * Subscribe to `vault://changed` events emitted by the Rust watcher.
   * Returns an unlisten function — callers MUST call it during teardown
   * to avoid leaking listeners.  The callback is invoked with the
   * already-validated payload; migration artifacts and self-writes are
   * filtered out on the Rust side so the frontend only sees real
   * external changes.
   */
  async onChange(callback: (event: VaultChangeEvent) => void): Promise<UnlistenFn> {
    return listen<VaultChangeEvent>('vault://changed', (event) => {
      callback(event.payload);
    });
  },
};

export default vaultService;
