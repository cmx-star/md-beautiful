import { defineStore } from 'pinia';
import type { ViewMode } from '@/types';
import type { HighlightConfig } from '@/utils/highlightStyle';
import { DEFAULT_HIGHLIGHT_CONFIG } from '@/utils/highlightStyle';
import {
  findConflicts,
  resolveShortcuts,
  type ShortcutDef,
  type ShortcutOverrides,
} from '@/services/shortcutRegistry';

export const useThemeStore = defineStore('theme', {
  state: () => ({
    isDark: false as boolean,
    fontSize: 14 as number,
    tabSize: 2 as number,
    wordWrap: true as boolean,
    splitRatio: 50 as number,
    accentColor: '#e25555' as string,
    /** Phase 2 — 源码 / 分栏实时预览 / 阅读三种模式。 */
    viewMode: 'split' as ViewMode,
    /** Phase 2 — 编辑器 → 预览滚动同步开关。 */
    scrollSync: true as boolean,
    /** Phase 2 — 渐进隐藏非活动 Markdown 标记。 */
    hideMarks: true as boolean,
    /** Phase 2 — 用户可配置语法高亮（浅色/深色独立，可整体重置）。 */
    highlightLight: DEFAULT_HIGHLIGHT_CONFIG,
    highlightDark: DEFAULT_HIGHLIGHT_CONFIG,
    /** Phase 2 — 快捷键自定义（id → 覆盖键位）。 */
    shortcutOverrides: {} as ShortcutOverrides,
  }),
  actions: {
    toggleTheme() {
      this.isDark = !this.isDark;
      document.documentElement.classList.toggle('dark', this.isDark);
      this.saveSettings();
    },
    setFontSize(size: number) {
      this.fontSize = size;
      this.saveSettings();
    },
    setTabSize(size: number) {
      this.tabSize = size;
      this.saveSettings();
    },
    setWordWrap(wrap: boolean) {
      this.wordWrap = wrap;
      this.saveSettings();
    },
    setSplitRatio(ratio: number) {
      this.splitRatio = ratio;
      this.saveSettings();
    },
    setViewMode(mode: ViewMode) {
      this.viewMode = mode;
      this.saveSettings();
    },
    setScrollSync(enabled: boolean) {
      this.scrollSync = enabled;
      this.saveSettings();
    },
    setHideMarks(enabled: boolean) {
      this.hideMarks = enabled;
      this.saveSettings();
    },
    setHighlight(isDark: boolean, config: HighlightConfig) {
      if (isDark) this.highlightDark = config;
      else this.highlightLight = config;
      this.saveSettings();
    },
    resetHighlight(isDark: boolean) {
      this.setHighlight(isDark, { ...DEFAULT_HIGHLIGHT_CONFIG });
    },
    activeHighlight(): HighlightConfig {
      return this.isDark ? this.highlightDark : this.highlightLight;
    },
    shortcuts(): ShortcutDef[] {
      return resolveShortcuts(this.shortcutOverrides);
    },
    /**
     * Save a shortcut override.  Returns an error message when the new
     * binding conflicts with another action, or '' on success.
     */
    setShortcutKeys(id: string, keys: string[]): string {
      const next: ShortcutOverrides = { ...this.shortcutOverrides, [id]: keys };
      const conflicts = findConflicts(resolveShortcuts(next));
      if (conflicts.size > 0) {
        const first = Array.from(conflicts.keys())[0];
        return `快捷键 ${first} 已被其他命令占用，请先解除冲突`;
      }
      this.shortcutOverrides = next;
      this.saveSettings();
      return '';
    },
    resetShortcut(id: string) {
      const next = { ...this.shortcutOverrides };
      delete next[id];
      this.shortcutOverrides = next;
      this.saveSettings();
    },
    loadSettings() {
      try {
        const saved = localStorage.getItem('mardown-beautiful-theme');
        if (saved) {
          const s = JSON.parse(saved) as Record<string, unknown>;
          if (s.isDark) {
            this.isDark = true;
            document.documentElement.classList.add('dark');
          }
          if (s.fontSize) this.fontSize = s.fontSize as number;
          if (s.tabSize) this.tabSize = s.tabSize as number;
          if (s.wordWrap !== undefined) this.wordWrap = s.wordWrap as boolean;
          if (s.splitRatio) this.splitRatio = s.splitRatio as number;
          if (s.accentColor) {
            const savedAccent = s.accentColor as string;
            this.accentColor = savedAccent === '#0ea5e9' ? '#e25555' : savedAccent;
            document.documentElement.style.setProperty('--accent', this.accentColor);
          }
          if (
            s.viewMode === 'editor' ||
            s.viewMode === 'preview' ||
            s.viewMode === 'split'
          ) {
            this.viewMode = s.viewMode;
          }
          if (typeof s.scrollSync === 'boolean') this.scrollSync = s.scrollSync;
          if (typeof s.hideMarks === 'boolean') this.hideMarks = s.hideMarks;
          if (isHighlightConfig(s.highlightLight)) this.highlightLight = s.highlightLight;
          if (isHighlightConfig(s.highlightDark)) this.highlightDark = s.highlightDark;
          if (
            typeof s.shortcutOverrides === 'object' &&
            s.shortcutOverrides !== null
          ) {
            this.shortcutOverrides = s.shortcutOverrides as ShortcutOverrides;
          }
        }
      } catch {
        // ignore
      }
    },
    saveSettings() {
      localStorage.setItem(
        'mardown-beautiful-theme',
        JSON.stringify({
          isDark: this.isDark,
          fontSize: this.fontSize,
          tabSize: this.tabSize,
          wordWrap: this.wordWrap,
          splitRatio: this.splitRatio,
          accentColor: this.accentColor,
          viewMode: this.viewMode,
          scrollSync: this.scrollSync,
          hideMarks: this.hideMarks,
          highlightLight: this.highlightLight,
          highlightDark: this.highlightDark,
          shortcutOverrides: this.shortcutOverrides,
        })
      );
    },
  },
});

function isHighlightConfig(value: unknown): value is HighlightConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.heading === 'string' && typeof v.link === 'string';
}
