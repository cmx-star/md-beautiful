/**
 * Shortcut registry (Phase 2) — single source of truth for keybindings.
 *
 * - Combos are normalized to cross-platform strings: `Mod` means ⌘ on macOS
 *   and Ctrl elsewhere, so `Mod-b` works on every platform.
 * - Users can override defaults; overrides persist in a dedicated,
 *   non-sensitive localStorage key.
 * - Conflicts (two actions claiming the same combo) must be resolved before
 *   a customization is saved — the settings UI enforces this.
 */

export type ShortcutScope = 'app' | 'editor';

export interface ShortcutDef {
  id: string;
  label: string;
  scope: ShortcutScope;
  /** Normalized combos, e.g. `["Mod-k"]`. Empty array = no default binding. */
  keys: string[];
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // App scope — handled on the window keydown listener.
  { id: 'palette', label: '命令面板', scope: 'app', keys: ['Mod-k'] },
  { id: 'new-note', label: '新建笔记', scope: 'app', keys: ['Mod-n'] },
  { id: 'open-file', label: '打开 Markdown 文件', scope: 'app', keys: ['Mod-o'] },
  { id: 'open-vault', label: '打开 Vault', scope: 'app', keys: ['Mod-Shift-o'] },
  { id: 'toggle-sidebar', label: '切换侧边栏', scope: 'app', keys: ['Mod-\\'] },
  { id: 'toggle-theme', label: '切换主题', scope: 'app', keys: ['Mod-Shift-t'] },
  { id: 'view-editor', label: '仅编辑器模式', scope: 'app', keys: ['Mod-1'] },
  { id: 'view-split', label: '分栏实时预览模式', scope: 'app', keys: ['Mod-2'] },
  { id: 'view-preview', label: '阅读模式', scope: 'app', keys: ['Mod-3'] },
  { id: 'toggle-preview', label: '切换预览显隐', scope: 'app', keys: ['Mod-p'] },
  { id: 'search', label: '搜索笔记', scope: 'app', keys: ['Mod-f'] },
  { id: 'export', label: '导出当前文档', scope: 'app', keys: ['Mod-Shift-e'] },
  { id: 'sync', label: '同步', scope: 'app', keys: ['Mod-Shift-s'] },
  // Editor scope — handled by the CodeMirror keymap while editing.
  { id: 'fmt-bold', label: '加粗', scope: 'editor', keys: ['Mod-b'] },
  { id: 'fmt-italic', label: '斜体', scope: 'editor', keys: ['Mod-i'] },
  { id: 'fmt-code', label: '行内代码', scope: 'editor', keys: ['Mod-e'] },
  { id: 'fmt-link', label: '插入链接', scope: 'editor', keys: ['Mod-Shift-l'] },
  { id: 'fmt-heading', label: '标题（循环切换级别）', scope: 'editor', keys: ['Mod-Shift-h'] },
  { id: 'fmt-quote', label: '引用', scope: 'editor', keys: ['Mod-Shift-q'] },
  { id: 'fmt-bullet', label: '无序列表', scope: 'editor', keys: ['Mod-Shift-u'] },
  { id: 'fmt-ordered', label: '有序列表', scope: 'editor', keys: ['Mod-Shift-n'] },
  { id: 'fmt-task', label: '任务列表', scope: 'editor', keys: ['Mod-Shift-x'] },
];

export const SHORTCUTS_STORAGE_KEY = 'mardown-beautiful-shortcuts';

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

/** Canonicalize a stored combo string (uppercase single-letter keys). */
export function canonicalCombo(combo: string): string {
  const parts = combo.split('-');
  const key = parts[parts.length - 1];
  if (/^[a-z]$/.test(key)) {
    parts[parts.length - 1] = key.toUpperCase();
  }
  return parts.join('-');
}

/** Normalize a KeyboardEvent into a canonical combo string, or null. */
export function normalizeCombo(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (key === ' ') key = 'Space';
  else if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  parts.push(key);
  return parts.join('-');
}

/** Convert a normalized combo to a CodeMirror keymap key string. */
export function comboToCodeMirror(combo: string): string {
  return combo;
}

export type ShortcutOverrides = Record<string, string[]>;

export function loadShortcutOverrides(storage: Storage | null): ShortcutOverrides {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SHORTCUTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ShortcutOverrides;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const clean: ShortcutOverrides = {};
    for (const [id, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) {
        clean[id] = keys;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveShortcutOverrides(
  storage: Storage | null,
  overrides: ShortcutOverrides
): void {
  if (!storage) return;
  storage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides));
}

/** Merge defaults with user overrides (an action may be unbound with `[]`). */
export function resolveShortcuts(
  overrides: ShortcutOverrides = {},
  defaults: ShortcutDef[] = DEFAULT_SHORTCUTS
): ShortcutDef[] {
  return defaults.map((def) => ({
    ...def,
    keys: (overrides[def.id] ?? def.keys).map(canonicalCombo),
  }));
}

/** Group conflicting combos: combo → action ids claiming it. */
export function findConflicts(defs: ShortcutDef[]): Map<string, string[]> {
  const claim = new Map<string, string[]>();
  for (const def of defs) {
    for (const combo of def.keys) {
      const ids = claim.get(combo) ?? [];
      ids.push(def.id);
      claim.set(combo, ids);
    }
  }
  const conflicts = new Map<string, string[]>();
  for (const [combo, ids] of claim) {
    if (ids.length > 1) conflicts.set(combo, ids);
  }
  return conflicts;
}

const MAC_KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '⏎',
  Escape: '⎋',
  Space: 'Space',
  '\\': '\\',
};

/** Human-readable combo for the current platform (mac symbols vs Win/Linux). */
export function formatCombo(combo: string, isMac: boolean): string {
  const parts = combo.split('-');
  const key = parts[parts.length - 1];
  const hasMod = parts.includes('Mod');
  const hasAlt = parts.includes('Alt');
  const hasShift = parts.includes('Shift');
  const keyLabel = MAC_KEY_LABELS[key] ?? key.toUpperCase();
  if (isMac) {
    let out = '';
    if (hasMod) out += '⌘';
    if (hasAlt) out += '⌥';
    if (hasShift) out += '⇧';
    return out + keyLabel;
  }
  const out: string[] = [];
  if (hasMod) out.push('Ctrl');
  if (hasAlt) out.push('Alt');
  if (hasShift) out.push('Shift');
  out.push(keyLabel);
  return out.join('+');
}
