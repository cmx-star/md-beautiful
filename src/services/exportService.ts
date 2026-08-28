/**
 * Export service (Phase 5) — the frontend half of the Export Service.
 *
 * Formats "html" and "txt" are always available (app-native engines).
 * Pandoc-backed formats require the pandoc CLI on the host; availability is
 * probed with `export_detect_pandoc` so the UI can disable them up front.
 * A missing attachment aborts the export Rust-side — nothing is written.
 */

import { invoke } from '@tauri-apps/api/core';
import { resolveAssetPath } from '@/utils/assetPath';
import { slugifyTitle } from '@/utils/slugify';

export type ExportFormat =
  | 'html'
  | 'txt'
  | 'docx'
  | 'odt'
  | 'latex'
  | 'rst'
  | 'mediawiki'
  | 'epub'
  | 'pdf'
  | 'print';

export const PANDOC_FORMATS: ExportFormat[] = [
  'docx',
  'odt',
  'latex',
  'rst',
  'mediawiki',
  'epub',
  'pdf',
];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  html: 'HTML 网页',
  txt: '纯文本 TXT',
  docx: 'Microsoft Word (DOCX)',
  odt: 'OpenDocument (ODT)',
  latex: 'LaTeX 源码',
  rst: 'reStructuredText',
  mediawiki: 'MediaWiki',
  epub: 'EPUB 电子书',
  pdf: 'PDF（Pandoc + LaTeX）',
  print: '打印 / 系统另存为 PDF',
};

export interface ExportReport {
  ok: boolean;
  format: string;
  target_path: string;
  size: number;
  engine: string;
  warnings: string[];
  missing_resources: string[];
  error?: string;
}

const EXT_BY_FORMAT: Partial<Record<ExportFormat, string>> = {
  html: 'html',
  txt: 'txt',
  docx: 'docx',
  odt: 'odt',
  latex: 'tex',
  rst: 'rst',
  mediawiki: 'txt',
  epub: 'epub',
  pdf: 'pdf',
};

export const exportService = {
  async detectPandoc(): Promise<string | null> {
    try {
      return await invoke<string | null>('export_detect_pandoc');
    } catch {
      return null;
    }
  },

  /** Vault-relative `assets/…` references in the markdown source. */
  collectResources(markdown: string, notePath: string): string[] {
    const resources = new Set<string>();
    const referenceRe = /!?\[[^\]]*\]\(([^)\s]+)\)|<img[^>]+src="([^"]+)"/g;
    for (const match of markdown.matchAll(referenceRe)) {
      const src = match[1] ?? match[2];
      if (!src) continue;
      const asset = resolveAssetPath(notePath, src);
      if (asset && asset.startsWith('assets/')) resources.add(asset);
    }
    return Array.from(resources);
  },

  suggestedFileName(title: string, format: ExportFormat): string {
    const base = slugifyTitle(title) || 'document';
    const ext = EXT_BY_FORMAT[format] ?? 'txt';
    return `${base}.${ext}`;
  },

  /** Native save dialog; returns the absolute target path or null. */
  async pickTargetPath(
    title: string,
    format: ExportFormat
  ): Promise<string | null> {
    const fileName = exportService.suggestedFileName(title, format);
    // @ts-expect-error Tauri dialog global
    const selected = await window.__TAURI__.dialog.save({
      title: '导出文档',
      defaultPath: fileName,
    });
    if (!selected) return null;
    return typeof selected === 'string' ? selected : null;
  },

  async exportCurrent(options: {
    title: string;
    markdown: string;
    bodyHtml: string;
    format: ExportFormat;
    userCss?: string;
    targetPath: string;
    notePath: string;
  }): Promise<ExportReport> {
    return invoke<ExportReport>('export_document', {
      format: options.format,
      title: options.title,
      markdown: options.markdown,
      bodyHtml: options.format === 'html' ? options.bodyHtml : null,
      userCss: options.userCss || null,
      targetPath: options.targetPath,
      resources: exportService.collectResources(options.markdown, options.notePath),
    });
  },
};

export default exportService;
