import { describe, it, expect } from 'vitest';
import {
  buildNoteFile,
  parseFrontmatter,
  serializeFrontmatter,
  type FrontmatterDoc,
} from './frontmatter';

const base: FrontmatterDoc = {
  id: 'abc-123',
  title: 'Hello world',
  tags: ['alpha', 'beta'],
  folderId: null,
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
  wordCount: 42,
  isFavorite: false,
};

describe('serializeFrontmatter', () => {
  it('emits all required fields in canonical order', () => {
    const out = serializeFrontmatter(base);
    const order = [
      'id:',
      'title:',
      'tags:',
      'created_at:',
      'updated_at:',
      'word_count:',
      'is_favorite:',
    ];
    let cursor = 0;
    for (const needle of order) {
      const idx = out.indexOf(needle, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + needle.length;
    }
  });

  it('omits folder_id when null', () => {
    expect(serializeFrontmatter(base)).not.toMatch(/folder_id/);
  });

  it('includes folder_id when set', () => {
    const withFolder = { ...base, folderId: 'folder-1' };
    expect(serializeFrontmatter(withFolder)).toMatch(/folder_id: folder-1/);
  });

  it('quotes title with special YAML characters', () => {
    const tricky = { ...base, title: 'title: with colon' };
    expect(serializeFrontmatter(tricky)).toMatch(/"title: with colon"/);
  });
});

describe('parseFrontmatter', () => {
  it('round-trips serialize/parse for the canonical shape', () => {
    const file = buildNoteFile(base, 'body line one\nbody line two');
    const parsed = parseFrontmatter(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter).toEqual(base);
    expect(parsed!.body).toBe('body line one\nbody line two');
  });

  it('returns null when the file has no frontmatter', () => {
    expect(parseFrontmatter('just some markdown\n\nmore text')).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    const partial =
      '---\nid: x\ntitle: y\ncreated_at: 1\nupdated_at: 1\nword_count: 1\n---\nbody';
    expect(parseFrontmatter(partial)).toBeNull();
  });

  it('parses empty tags list', () => {
    const doc = { ...base, tags: [] as string[] };
    const file = buildNoteFile(doc, '');
    const parsed = parseFrontmatter(file);
    expect(parsed?.frontmatter.tags).toEqual([]);
  });

  it('treats folder_id absence as null', () => {
    const file = buildNoteFile(base, 'x');
    expect(parseFrontmatter(file)!.frontmatter.folderId).toBeNull();
  });
});
