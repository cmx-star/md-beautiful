/**
 * Vault service — wraps Tauri IPC commands for Vault-bounded file operations.
 */

import { invoke } from '@tauri-apps/api/core';

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
};

export default vaultService;
