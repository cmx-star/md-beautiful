import { describe, expect, it } from 'vitest';
import {
  applyPropertyEdits,
  parseProperties,
  parseTagsValue,
  serializeTagsValue,
} from './properties';

describe('parseProperties', () => {
  it('returns fields and body for valid frontmatter', () => {
    const raw = '---\ntitle: Hello\ntags: [a, b]\ncustom: keep me\n---\n\nBody\n';
    const parsed = parseProperties(raw);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.fields.map((f) => f.key)).toEqual(['title', 'tags', 'custom']);
    expect(parsed.fields[2].known).toBe(false);
    expect(parsed.body).toBe('\nBody\n');
  });

  it('treats documents without frontmatter as body-only', () => {
    const parsed = parseProperties('# Just markdown\n');
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.fields).toEqual([]);
    expect(parsed.body).toBe('# Just markdown\n');
  });
});

describe('applyPropertyEdits', () => {
  it('preserves untouched unknown fields byte-for-byte', () => {
    const raw = '---\ntitle: Hello\ncustom:  keep   me  \n---\nBody';
    const out = applyPropertyEdits(raw, [
      { key: 'title', value: 'Changed' },
      { key: 'custom', value: 'keep   me' }, // unchanged value → original line kept
    ]);
    expect(out).toContain('custom:  keep   me  ');
    expect(out).toContain('title: Changed');
  });

  it('appends new keys and removes keys by omission', () => {
    const raw = '---\ntitle: A\nstatus: draft\n---\nBody';
    const out = applyPropertyEdits(raw, [
      { key: 'title', value: 'A' },
      { key: 'priority', value: 'high' },
    ]);
    expect(out).not.toContain('status');
    expect(out).toContain('priority: high');
    expect(out).toContain('title: A');
  });

  it('creates frontmatter on a document that had none', () => {
    const out = applyPropertyEdits('# Body only\n', [
      { key: 'title', value: 'New' },
    ]);
    expect(out.startsWith('---\ntitle: New\n---\n')).toBe(true);
    expect(out).toContain('# Body only');
  });

  it('quotes values that would break YAML scalars', () => {
    const out = applyPropertyEdits('', [{ key: 'note', value: 'a: b' }]);
    expect(out).toContain('note: "a: b"');
  });

  it('returns input unchanged when there are no edits', () => {
    const raw = '---\ntitle: A\n---\nBody';
    expect(applyPropertyEdits(raw, [])).toBe(raw);
  });
});

describe('tags helpers', () => {
  it('parses bracketed and plain lists', () => {
    expect(parseTagsValue('[a, b, "c d"]')).toEqual(['a', 'b', 'c d']);
    expect(parseTagsValue('x, y')).toEqual(['x', 'y']);
  });

  it('serializes lists back to bracket form', () => {
    expect(serializeTagsValue(['a', 'b'])).toBe('[a, b]');
    expect(serializeTagsValue(['has: colon'])).toBe('["has: colon"]');
  });
});
