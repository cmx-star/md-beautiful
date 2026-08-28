import { describe, expect, it } from 'vitest';
import {
  codeBlock,
  EMPTY_TABLE,
  mathBlock,
  splitLinePrefix,
  toggleBlockQuote,
  toggleBulletList,
  toggleHeading,
  toggleLink,
  toggleLinePrefix,
  toggleNumberedList,
  toggleTaskDone,
  toggleWrap,
} from './markdownTransform';

describe('splitLinePrefix', () => {
  it('splits heading, quote, list, and task prefixes', () => {
    expect(splitLinePrefix('# 标题')).toEqual({ indent: '', prefix: '# ', content: '标题' });
    expect(splitLinePrefix('> 引用')).toEqual({ indent: '', prefix: '> ', content: '引用' });
    expect(splitLinePrefix('- 项目')).toEqual({ indent: '', prefix: '- ', content: '项目' });
    expect(splitLinePrefix('- [ ] 待办')).toEqual({ indent: '', prefix: '- [ ] ', content: '待办' });
    expect(splitLinePrefix('- [x] 完成')).toEqual({ indent: '', prefix: '- [x] ', content: '完成' });
    expect(splitLinePrefix('1. 有序')).toEqual({ indent: '', prefix: '1. ', content: '有序' });
    expect(splitLinePrefix('  正文')).toEqual({ indent: '  ', prefix: '', content: '正文' });
    expect(splitLinePrefix('### 三级')).toEqual({ indent: '', prefix: '### ', content: '三级' });
  });
});

describe('toggleLinePrefix', () => {
  it('adds and removes prefix', () => {
    expect(toggleLinePrefix('text', '- ')).toBe('- text');
    expect(toggleLinePrefix('- text', '- ')).toBe('text');
    expect(toggleLinePrefix('> quote', '> ')).toBe('quote');
  });

  it('preserves indentation', () => {
    expect(toggleLinePrefix('  text', '- ')).toBe('  - text');
    expect(toggleLinePrefix('  - text', '- ')).toBe('  text');
  });
});

describe('toggleHeading', () => {
  it('adds, switches, and clears levels', () => {
    expect(toggleHeading('title', 1)).toBe('# title');
    expect(toggleHeading('# title', 2)).toBe('## title');
    expect(toggleHeading('## title', 2)).toBe('title');
    expect(toggleHeading('## title', 3)).toBe('### title');
  });
});

describe('task toggling', () => {
  it('toggles between unchecked and checked', () => {
    expect(toggleTaskDone('- [ ] 买牛奶')).toBe('- [x] 买牛奶');
    expect(toggleTaskDone('- [x] 买牛奶')).toBe('- [ ] 买牛奶');
    expect(toggleTaskDone('买牛奶')).toBe('- [ ] 买牛奶');
  });
});

describe('list toggling', () => {
  it('toggles bullet and ordered lists', () => {
    expect(toggleBulletList('a')).toBe('- a');
    expect(toggleBulletList('- a')).toBe('a');
    expect(toggleNumberedList('a')).toBe('1. a');
    expect(toggleNumberedList('1. a')).toBe('a');
    expect(toggleBlockQuote('a')).toBe('> a');
  });
});

describe('toggleWrap', () => {
  it('wraps empty selection with placeholder text', () => {
    const t = toggleWrap('', '**');
    expect(t.insert).toBe('**文本**');
    expect(t.selectionStart).toBe(2);
    expect(t.selectionEnd).toBe(4);
  });

  it('unwraps when selection already wrapped', () => {
    const t = toggleWrap('**加粗**', '**');
    expect(t.insert).toBe('加粗');
    expect(t.selectionStart).toBe(0);
    expect(t.selectionEnd).toBe(2);
  });

  it('wraps inline code', () => {
    expect(toggleWrap('code', '`').insert).toBe('`code`');
  });
});

describe('toggleLink', () => {
  it('creates a link with url selected', () => {
    const t = toggleLink('');
    expect(t.insert).toBe('[链接](url)');
    expect(t.insert.slice(t.selectionStart, t.selectionEnd)).toBe('url');
  });

  it('unwraps an existing link to its label', () => {
    const t = toggleLink('[标签](https://x.y)');
    expect(t.insert).toBe('标签');
  });
});

describe('snippets', () => {
  it('produces table, math, and code block snippets', () => {
    expect(EMPTY_TABLE.split('\n').length).toBe(3);
    expect(mathBlock(false)).toBe('$公式$');
    expect(mathBlock(true)).toBe('$$\n公式\n$$');
    expect(codeBlock('ts')).toBe('```ts\n\n```\n');
    expect(codeBlock()).toBe('```\n\n```\n');
  });
});
