import { invoke } from '@tauri-apps/api/core';

export interface OpenedMarkdownFile {
  path: string;
  name: string;
  content: string;
  mtime: number;
  size: number;
}

export interface DocumentFingerprint {
  path: string;
  mtime: number;
  size: number;
}

export const documentService = {
  pickMarkdownFile(): Promise<OpenedMarkdownFile | null> {
    return invoke<OpenedMarkdownFile | null>('pick_markdown_file');
  },
  writeMarkdownFile(path: string, content: string): Promise<DocumentFingerprint> {
    return invoke<DocumentFingerprint>('write_open_markdown_file', { path, content });
  },
};

export default documentService;
