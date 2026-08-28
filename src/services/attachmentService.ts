/**
 * Attachment service (Phase 1-C) — wraps the Rust attachment commands.
 *
 * Attachments live under `<vault>/assets/`.  Import (drag & drop from the
 * OS) streams the file through the backend; clipboard images are encoded as
 * base64 in the webview and written via `vault_write_attachment`.  All
 * collision handling (photo.png → photo-1.png) happens Rust-side.
 */

import { invoke } from '@tauri-apps/api/core';
import { isImageName, relativeAssetLink } from '@/utils/assetPath';

export interface AttachmentInfo {
  path: string;
  name: string;
  size: number;
}

export interface AttachmentAudit {
  total: number;
  orphans: string[];
}

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** Mirror of the Rust-side sanitizer so the UI can predict target names. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !(code < 0x20 || (code >= 0x7f && code <= 0x9f));
    })
    .join('');
  const trimmed = cleaned.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    return 'attachment';
  }
  return trimmed;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

const dataUrlCache = new Map<string, Promise<string>>();

export const attachmentService = {
  /** Import an OS file (e.g. drag & drop source path) into `<vault>/assets/`. */
  async importFromPath(sourcePath: string): Promise<AttachmentInfo> {
    return invoke<AttachmentInfo>('vault_import_attachment', { sourcePath });
  },

  /** Write clipboard / in-memory bytes into `<vault>/assets/`. */
  async writeFromBytes(name: string, bytes: Uint8Array): Promise<AttachmentInfo> {
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`附件超过大小限制（${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB）`);
    }
    return invoke<AttachmentInfo>('vault_write_attachment', {
      name,
      dataBase64: bytesToBase64(bytes),
    });
  },

  /** Read an attachment as a `data:` URL (CSP already allows `img-src data:`). */
  async readAsDataUrl(relativePath: string): Promise<string> {
    const payload = await invoke<{ path: string; name: string; dataBase64: string }>(
      'vault_read_attachment',
      { relativePath }
    );
    return `data:${mimeFromName(payload.name)};base64,${payload.dataBase64}`;
  },

  /** Cached variant used by the preview renderer. */
  readAsDataUrlCached(relativePath: string): Promise<string> {
    let cached = dataUrlCache.get(relativePath);
    if (!cached) {
      cached = this.readAsDataUrl(relativePath).catch((error: unknown) => {
        dataUrlCache.delete(relativePath);
        throw error;
      });
      dataUrlCache.set(relativePath, cached);
    }
    return cached;
  },

  /** Report-only orphan audit — nothing is ever deleted automatically. */
  async audit(): Promise<AttachmentAudit> {
    return invoke<AttachmentAudit>('vault_audit_attachments');
  },
};

/** Build the markdown text to insert for a freshly imported attachment. */
export function attachmentMarkdown(info: AttachmentInfo, notePath: string): string {
  const link = relativeAssetLink(notePath, info.path);
  return isImageName(info.name) ? `![](${link})` : `[${info.name}](${link})`;
}

export { isImageName };

export default attachmentService;
