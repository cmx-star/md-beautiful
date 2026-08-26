/**
 * Smoke tests for the Phase 1-A "笔记数据" Settings UI.
 *
 * Phase 0 established a JS-only test style (no @vue/test-utils, no
 * component compiler), so this file uses static string assertions against
 * the `.vue` source files.  It is intended to catch regressions in the
 * contract: the DataSettings panel + the App.vue draft-recovery dialog
 * must keep their aria-labels, three-option buttons, and i18n strings.
 */
import { describe, it, expect } from 'vitest';
// Vite's `?raw` import gives us the source file as a string without
// pulling in `node:fs` (which would force `@types/node` into the
// frontend typecheck).
import dataSettingsSource from './DataSettings.vue?raw';
import appSource from '../../App.vue?raw';

describe('DataSettings.vue (笔记数据 Settings UI)', () => {
  const source = dataSettingsSource;

  it('contains the i18n heading "笔记数据"', () => {
    expect(source).toMatch(/笔记数据/);
  });

  it('exposes a snapshot list with a rollback button per entry', () => {
    expect(source).toMatch(/迁移快照/);
    expect(source).toMatch(/data-testid="snapshot-list"/);
    expect(source).toMatch(/一键回滚/);
  });

  it('exposes a draft list with a recover button per entry', () => {
    expect(source).toMatch(/未保存草稿/);
    expect(source).toMatch(/data-testid="draft-list"/);
    expect(source).toMatch(/mardown-beautiful-drafts/);
    expect(source).toMatch(/恢复/);
  });

  it('renders the migration log panel with the last 10 entries', () => {
    expect(source).toMatch(/迁移日志（最近 10 条）/);
    expect(source).toMatch(/data-testid="migration-log"/);
  });

  it('emits revert and recover-draft events', () => {
    expect(source).toMatch(/defineEmits</);
    expect(source).toMatch(/'revert'/);
    expect(source).toMatch(/'recover-draft'/);
  });
});

describe('App.vue (draft recovery dialog)', () => {
  const source = appSource;

  it('renders an alertdialog titled "检测到未保存的草稿"', () => {
    expect(source).toMatch(/role="alertdialog"/);
    expect(source).toMatch(/aria-label="检测到未保存的草稿"/);
    expect(source).toMatch(/检测到未保存的草稿/);
  });

  it('offers three recovery options: 恢复 / 仅查看 / 放弃', () => {
    expect(source).toMatch(/恢复（覆盖 Vault 内对应文件）/);
    expect(source).toMatch(/仅查看/);
    expect(source).toMatch(/放弃/);
  });

  it('tags every action button with an aria-label', () => {
    expect(source).toMatch(/aria-label="`恢复草稿/);
    expect(source).toMatch(/aria-label="`仅查看草稿/);
    expect(source).toMatch(/aria-label="`放弃草稿/);
  });

  it('wires the CommandPalette "笔记数据" entry to open DataSettings', () => {
    expect(source).toMatch(/@open-data-settings="showDataSettings = true"/);
  });
});
