import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  comboToCodeMirror,
  findConflicts,
  formatCombo,
  loadShortcutOverrides,
  normalizeCombo,
  resolveShortcuts,
  saveShortcutOverrides,
  type ShortcutDef,
} from './shortcutRegistry';

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'b',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe('normalizeCombo', () => {
  it('maps meta and ctrl to the same Mod prefix', () => {
    expect(normalizeCombo(keyEvent({ metaKey: true }))).toBe('Mod-B');
    expect(normalizeCombo(keyEvent({ ctrlKey: true }))).toBe('Mod-B');
  });

  it('includes alt and shift in canonical order', () => {
    expect(normalizeCombo(keyEvent({ ctrlKey: true, shiftKey: true, key: 'l' }))).toBe(
      'Mod-Shift-L'
    );
    expect(normalizeCombo(keyEvent({ altKey: true, key: 'h' }))).toBe('Alt-H');
  });

  it('handles special keys and bare modifier presses', () => {
    expect(normalizeCombo(keyEvent({ key: ' ' }))).toBe('Space');
    expect(normalizeCombo(keyEvent({ key: 'Shift' }))).toBeNull();
    expect(normalizeCombo(keyEvent({ key: 'ArrowDown' }))).toBe('ArrowDown');
  });

  it('distinguishes shifted symbol keys', () => {
    // Shift+1 produces '!' on most layouts — kept verbatim.
    expect(normalizeCombo(keyEvent({ shiftKey: true, key: '!' }))).toBe('Shift-!');
  });
});

describe('overrides persistence', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage;
    saveShortcutOverrides(fakeStorage, { 'fmt-bold': ['Mod-Shift-b'] });
    expect(loadShortcutOverrides(fakeStorage)).toEqual({ 'fmt-bold': ['Mod-Shift-b'] });
  });

  it('returns empty on corrupt data or missing storage', () => {
    expect(loadShortcutOverrides(null)).toEqual({});
    const bad = { getItem: () => '{oops' } as unknown as Storage;
    expect(loadShortcutOverrides(bad)).toEqual({});
  });
});

describe('resolveShortcuts', () => {
  it('applies overrides and allows unbinding', () => {
    const resolved = resolveShortcuts({ 'fmt-bold': [], palette: ['Mod-p'] });
    expect(resolved.find((d) => d.id === 'fmt-bold')?.keys).toEqual([]);
    expect(resolved.find((d) => d.id === 'palette')?.keys).toEqual(['Mod-P']);
    expect(resolved.find((d) => d.id === 'new-note')?.keys).toEqual(['Mod-N']);
  });
});

describe('findConflicts', () => {
  it('detects duplicate combos across scopes', () => {
    const defs: ShortcutDef[] = [
      { id: 'a', label: 'A', scope: 'app', keys: ['Mod-x'] },
      { id: 'b', label: 'B', scope: 'editor', keys: ['Mod-x'] },
      { id: 'c', label: 'C', scope: 'editor', keys: ['Mod-y'] },
    ];
    const conflicts = findConflicts(defs);
    expect(conflicts.get('Mod-x')).toEqual(['a', 'b']);
    expect(conflicts.has('Mod-y')).toBe(false);
  });

  it('has no conflicts in the default layout', () => {
    expect(findConflicts(DEFAULT_SHORTCUTS).size).toBe(0);
  });
});

describe('formatCombo', () => {
  it('renders mac symbols and win/linux text', () => {
    expect(formatCombo('Mod-k', true)).toBe('⌘K');
    expect(formatCombo('Mod-Shift-o', true)).toBe('⌘⇧O');
    expect(formatCombo('Mod-Shift-o', false)).toBe('Ctrl+Shift+O');
    expect(formatCombo('Mod-\\', true)).toBe('⌘\\');
  });
});

describe('comboToCodeMirror', () => {
  it('passes normalized combos straight through', () => {
    expect(comboToCodeMirror('Mod-Shift-L')).toBe('Mod-Shift-L');
  });
});
