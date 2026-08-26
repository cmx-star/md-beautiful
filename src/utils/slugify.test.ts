import { describe, it, expect } from 'vitest';
import { slugifyTitle, candidateFileName, withCollisionSuffix } from './slugify';

describe('slugifyTitle', () => {
  it('keeps ascii letters, digits, dashes and underscores', () => {
    expect(slugifyTitle('Hello World 2024')).toBe('Hello-World-2024');
    expect(slugifyTitle('foo_bar-baz.qux')).toBe('foo_bar-baz.qux');
  });

  it('strips path separators and NUL to dash, then cleans up', () => {
    expect(slugifyTitle('a/b\\c')).toBe('a-b-c');
    expect(slugifyTitle('a\x00b')).toBe('a-b');
  });

  it('rejects parent-dir payloads', () => {
    expect(slugifyTitle('..')).toBe('untitled');
    expect(slugifyTitle('../etc/passwd')).toBe('etc-passwd');
    expect(slugifyTitle('a..b')).toBe('a..b');
  });

  it('caps at 60 characters and trims trailing punctuation', () => {
    const title = 'a'.repeat(120);
    const slug = slugifyTitle(title);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.endsWith('.')).toBe(false);
  });

  it('falls back to untitled for empty or whitespace input', () => {
    expect(slugifyTitle('')).toBe('untitled');
    expect(slugifyTitle('   ')).toBe('untitled');
    expect(slugifyTitle(null)).toBe('untitled');
    expect(slugifyTitle(undefined)).toBe('untitled');
  });

  it('prefixes reserved Windows device names with note-', () => {
    expect(slugifyTitle('CON')).toBe('note-CON');
    expect(slugifyTitle('com1')).toBe('note-com1');
    expect(slugifyTitle('nul')).toBe('note-nul');
  });

  it('produces stable output for the same input', () => {
    expect(slugifyTitle('Phase 1 — Migration')).toBe(slugifyTitle('Phase 1 — Migration'));
  });
});

describe('candidateFileName', () => {
  it('appends .md to a slugified title', () => {
    expect(candidateFileName('hello world')).toBe('hello-world.md');
    expect(candidateFileName('')).toBe('untitled.md');
  });
});

describe('withCollisionSuffix', () => {
  it('returns base when attempt is 0', () => {
    expect(withCollisionSuffix('a.md', 0)).toBe('a.md');
  });

  it('inserts -N before the extension', () => {
    expect(withCollisionSuffix('a.md', 1)).toBe('a-1.md');
    expect(withCollisionSuffix('a.md', 2)).toBe('a-2.md');
  });

  it('handles names without extension', () => {
    expect(withCollisionSuffix('README', 1)).toBe('README-1');
  });

  it('only touches the last extension', () => {
    expect(withCollisionSuffix('foo.bar.md', 1)).toBe('foo.bar-1.md');
  });
});
