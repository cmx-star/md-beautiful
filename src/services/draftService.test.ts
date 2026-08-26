import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDraft,
  clearDraft,
  listRecoverableDrafts,
  classifyDraft,
  type DraftStore,
  type Drafts,
} from './draftService';

function memoryStore(initial: Drafts = {}): {
  store: DraftStore;
  data: Drafts;
} {
  const data: Drafts = { ...initial };
  return {
    data,
    store: {
      read: () => ({ ...data }),
      write: (next) => {
        Object.keys(data).forEach((k) => delete data[k]);
        Object.assign(data, next);
      },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('saveDraft / clearDraft', () => {
  it('round-trips through the injected store', () => {
    const { store, data } = memoryStore();
    saveDraft(
      'note-1',
      { content: 'hello', baseMtime: 100, baseSize: 5, savedAt: 200 },
      store
    );
    expect(data['note-1']).toEqual({
      content: 'hello',
      baseMtime: 100,
      baseSize: 5,
      savedAt: 200,
    });
    clearDraft('note-1', store);
    expect(data['note-1']).toBeUndefined();
  });

  it('uses localStorage when no store is provided', () => {
    saveDraft('n2', { content: 'a', baseMtime: 1, baseSize: 1, savedAt: 1 });
    expect(localStorage.getItem('mardown-beautiful-drafts')).toContain('"n2"');
    clearDraft('n2');
    expect(localStorage.getItem('mardown-beautiful-drafts')).not.toContain('"n2"');
  });

  it('does not throw when localStorage is unavailable', () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { localStorage?: Storage }).localStorage;
    try {
      expect(() =>
        saveDraft('x', { content: '', baseMtime: 0, baseSize: 0, savedAt: 0 })
      ).not.toThrow();
      expect(() => clearDraft('x')).not.toThrow();
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = original;
    }
  });

  it('keeps drafts from different keys isolated', () => {
    const { store, data } = memoryStore();
    saveDraft(
      'note-1',
      { content: 'a', baseMtime: 1, baseSize: 1, savedAt: 1 },
      store
    );
    saveDraft(
      'note-2',
      { content: 'b', baseMtime: 2, baseSize: 1, savedAt: 2 },
      store
    );
    clearDraft('note-1', store);
    expect(data['note-1']).toBeUndefined();
    expect(data['note-2']).toBeDefined();
  });
});

describe('listRecoverableDrafts', () => {
  it('returns drafts sorted by savedAt descending with computed age', () => {
    const { store } = memoryStore({
      a: { content: '', baseMtime: 0, baseSize: 0, savedAt: 100 },
      b: { content: '', baseMtime: 0, baseSize: 0, savedAt: 300 },
      c: { content: '', baseMtime: 0, baseSize: 0, savedAt: 200 },
    });
    const list = listRecoverableDrafts(store, () => 1000);
    expect(list.map((d) => d.noteId)).toEqual(['b', 'c', 'a']);
    expect(list[0].ageMs).toBe(700);
  });

  it('returns [] when no drafts exist', () => {
    const { store } = memoryStore();
    expect(listRecoverableDrafts(store)).toEqual([]);
  });
});

describe('classifyDraft', () => {
  it('returns no-fingerprint when current is null', () => {
    expect(
      classifyDraft(
        { content: 'x', baseMtime: 0, baseSize: 0, savedAt: 0 },
        null
      )
    ).toEqual({ kind: 'no-fingerprint' });
  });

  it('returns unchanged when mtime and size match the saved base', () => {
    const result = classifyDraft(
      { content: 'x', baseMtime: 100, baseSize: 5, savedAt: 0 },
      { mtime: 100, size: 5 }
    );
    expect(result.kind).toBe('unchanged');
  });

  it('returns modified when size differs', () => {
    const result = classifyDraft(
      { content: 'x', baseMtime: 100, baseSize: 5, savedAt: 0 },
      { mtime: 100, size: 6 }
    );
    expect(result.kind).toBe('modified');
  });

  it('returns modified when mtime differs', () => {
    const result = classifyDraft(
      { content: 'x', baseMtime: 100, baseSize: 5, savedAt: 0 },
      { mtime: 101, size: 5 }
    );
    expect(result.kind).toBe('modified');
  });
});
