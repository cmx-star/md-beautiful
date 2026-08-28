/**
 * User-configurable markdown syntax highlighting (Phase 2).
 *
 * Token groups map to `@lezer/highlight` tags; light and dark configs are
 * stored independently and can be reset to the defaults.
 */

import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export interface HighlightConfig {
  heading: string;
  emphasis: string;
  strong: string;
  link: string;
  inlineCode: string;
  quote: string;
}

export const DEFAULT_HIGHLIGHT_CONFIG: HighlightConfig = {
  heading: '#c0392b',
  emphasis: '#8e44ad',
  strong: '#d35400',
  link: '#2980b9',
  inlineCode: '#c7254e',
  quote: '#16a085',
};

export function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) || /^rgb\(/.test(trimmed)
    ? trimmed
    : fallback;
}

export function sanitizeHighlightConfig(value: unknown): HighlightConfig {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    heading: sanitizeColor(v.heading, DEFAULT_HIGHLIGHT_CONFIG.heading),
    emphasis: sanitizeColor(v.emphasis, DEFAULT_HIGHLIGHT_CONFIG.emphasis),
    strong: sanitizeColor(v.strong, DEFAULT_HIGHLIGHT_CONFIG.strong),
    link: sanitizeColor(v.link, DEFAULT_HIGHLIGHT_CONFIG.link),
    inlineCode: sanitizeColor(v.inlineCode, DEFAULT_HIGHLIGHT_CONFIG.inlineCode),
    quote: sanitizeColor(v.quote, DEFAULT_HIGHLIGHT_CONFIG.quote),
  };
}

/** Build a CodeMirror HighlightStyle from a user config. */
export function buildHighlightStyle(config: HighlightConfig): HighlightStyle {
  return HighlightStyle.define([
    { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: config.heading },
    { tag: [t.emphasis], color: config.emphasis, fontStyle: 'italic' },
    { tag: [t.strong], color: config.strong, fontWeight: '700' },
    { tag: [t.link, t.url], color: config.link },
    { tag: [t.monospace], color: config.inlineCode },
    { tag: [t.quote], color: config.quote },
  ]);
}
