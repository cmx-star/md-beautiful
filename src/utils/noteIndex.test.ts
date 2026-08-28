import { describe, expect, it } from 'vitest';
import {
  affectedNotesForRename,
  buildNoteIndex,
  extractFromContent,
  normalizeTarget,
  resolveLinkTarget,
  rewriteLinksAfterRename,
  searchNotes,
  splitFrontmatter,
  type IndexedNote,
} from './noteIndex';

function note(path: string, title: string, content: string, id?: string): IndexedNote {
  return {
    id: path.replace(/\.md$/, '').replace(/\//g, '-'),
    path,
    title,
    content,
    frontmatterId: id,
    tags: [],
    frontmatter: {},
  };
}

describe('splitFrontmatter', () => {
  it('parses simple key: value lines', () => {
    const { frontmatter, body } = splitFrontmatter('---\nid: abc\ntags: [a, b]\n---\nBody');
    expect(frontmatter.id).toBe('abc');
    expect(frontmatter.tags).toBe('[a, b]');
    expect(body).toBe('Body');
  });

  it('handles documents without frontmatter', () => {
    const { frontmatter, body } = splitFrontmatter('# Hello');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# Hello');
  });
});

describe('extractFromContent', () => {
  it('extracts wiki links, md links, and tags, skipping code blocks', () => {
    const raw = [
      '---',
      'tags: [project, archive]',
      '---',
      '看 [[My Note|别名]] 和 [[Plain]]',
      '还有 [文档](notes/doc.md) 与 [外部](https://example.com/x.md)',
      '标签 #work #项目-1',
      '```',
      '[[inside-code]] #fake-tag',
      '```',
    ].join('\n');
    const extracted = extractFromContent(raw);
    expect(extracted.wikiLinks.sort()).toEqual(['My Note', 'Plain']);
    expect(extracted.markdownLinks).toEqual(['notes/doc']);
    expect(extracted.tags.sort()).toEqual(['archive', 'project', 'work', '项目-1']);
    expect(extracted.wikiLinks).not.toContain('inside-code');
  });
});

describe('normalizeTarget', () => {
  it('strips extensions and ./ prefixes', () => {
    expect(normalizeTarget('./notes/foo.md')).toBe('notes/foo');
    expect(normalizeTarget('Bar.markdown')).toBe('Bar');
    expect(normalizeTarget('  Baz  ')).toBe('Baz');
  });
});

describe('resolveLinkTarget', () => {
  const notes = [
    note('notes/alpha.md', 'Alpha', '...', 'id-alpha'),
    note('notes/beta.md', 'Beta', '...'),
    note('docs/beta.md', 'Beta', '...'),
    note('notes/gamma.md', 'Gamma', '...'),
  ];
  const index = buildNoteIndex(notes);

  it('prefers explicit frontmatter id', () => {
    const r = resolveLinkTarget(index, 'id-alpha');
    expect(r.kind).toBe('resolved');
    expect((r as { path: string }).path).toBe('notes/alpha.md');
  });

  it('resolves exact vault paths', () => {
    const r = resolveLinkTarget(index, 'notes/gamma.md');
    expect(r).toMatchObject({ kind: 'resolved', path: 'notes/gamma.md' });
  });

  it('resolves unique titles and reports ambiguity', () => {
    expect(resolveLinkTarget(index, 'Gamma')).toMatchObject({ kind: 'resolved' });
    const r = resolveLinkTarget(index, 'Beta');
    expect(r.kind).toBe('ambiguous');
    expect((r as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it('resolves unique basenames across directories', () => {
    const r = resolveLinkTarget(index, 'gamma');
    expect(r).toMatchObject({ kind: 'resolved' });
  });

  it('reports unresolved targets', () => {
    expect(resolveLinkTarget(index, 'Missing').kind).toBe('unresolved');
  });
});

describe('buildNoteIndex', () => {
  it('computes backlinks and unresolved links', () => {
    const notes = [
      note('notes/a.md', 'A', 'links to [[B]] and [[Ghost]]'),
      note('notes/b.md', 'B', 'back to [[A]]'),
    ];
    const index = buildNoteIndex(notes);
    expect(index.backlinks.get('notes/b.md')).toEqual(['notes/a.md']);
    expect(index.backlinks.get('notes/a.md')).toEqual(['notes/b.md']);
    expect(index.unresolved.get('notes/a.md')).toEqual(['Ghost']);
    expect(index.outgoing.get('notes/a.md')).toEqual(['B', 'Ghost']);
  });
});

describe('searchNotes', () => {
  const notes = [
    note('notes/1.md', '项目计划', '正文提到 quarterly review', undefined),
    note('notes/2.md', '周报', '本周 #project 讨论', undefined),
    note('notes/3.md', '随手记', 'status: draft', undefined),
  ];
  notes[0].frontmatter = { status: 'active' };
  notes[0].tags = ['planning'];

  it('requires all terms to match and ranks title hits first', () => {
    const hits = searchNotes(notes, '项目 计划');
    expect(hits.map((h) => h.id)).toEqual(['notes-1']);
    const ranked = searchNotes(notes, 'project');
    expect(ranked.map((h) => h.id)).toEqual(['notes-2']);
    const attr = searchNotes(notes, 'status active');
    expect(attr.map((h) => h.id)).toEqual(['notes-1']);
  });

  it('returns everything for an empty query', () => {
    expect(searchNotes(notes, '   ')).toHaveLength(3);
  });
});

describe('rename rewriting', () => {
  const notes = [
    note('notes/a.md', 'A', 'see [[B]] and [[B|别名]] and [doc](./notes/b.md)'),
    note('notes/b.md', 'B', 'self'),
  ];
  const index = buildNoteIndex(notes);

  it('lists affected notes before rename', () => {
    expect(affectedNotesForRename(index, 'notes/b.md')).toEqual(['notes/a.md']);
  });

  it('rewrites wiki links (preserving aliases) and md links', () => {
    const content = 'see [[B]] and [[B|别名]] and [doc](./notes/b.md)';
    const out = rewriteLinksAfterRename(content, 'notes/b.md', 'B', 'notes/renamed-b.md');
    expect(out).toContain('[[renamed-b]]');
    expect(out).toContain('[[renamed-b|别名]]');
    expect(out).toContain('[doc](./renamed-b.md)');
  });

  it('leaves unrelated content untouched', () => {
    const content = '[[C]] and [x](https://example.com/b.md)';
    expect(rewriteLinksAfterRename(content, 'notes/b.md', 'B', 'notes/new.md')).toBe(content);
  });
});
