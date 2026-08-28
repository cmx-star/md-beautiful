import { describe, expect, it } from 'vitest';
import {
  formulaCacheKey,
  mathConfigId,
  mathSignature,
  splitMathSegments,
} from './mathSegments';

describe('splitMathSegments', () => {
  it('splits inline and display math', () => {
    const segments = splitMathSegments('能量 $E=mc^2$ 与\n\n$$\\int_0^1 x dx$$\n');
    expect(segments).toEqual([
      { type: 'text', value: '能量 ' },
      { type: 'math', value: 'E=mc^2', display: 'inline' },
      { type: 'text', value: ' 与\n\n' },
      { type: 'math', value: '\\int_0^1 x dx', display: 'display' },
      { type: 'text', value: '\n' },
    ]);
  });

  it('supports \\( \\) and \\[ \\] delimiters', () => {
    const segments = splitMathSegments('\\(a+b\\) and \\[c-d\\]');
    expect(segments.filter((s) => s.type === 'math')).toEqual([
      { type: 'math', value: 'a+b', display: 'inline' },
      { type: 'math', value: 'c-d', display: 'display' },
    ]);
  });

  it('ignores math inside fenced code blocks and inline code', () => {
    const content = '```\n$x$\n```\n文字 `$y$` 与 $z$\n~~~\n$$q$$\n~~~';
    const segments = splitMathSegments(content);
    const math = segments.filter((s) => s.type === 'math');
    expect(math).toEqual([{ type: 'math', value: 'z', display: 'inline' }]);
    const text = segments.filter((s) => s.type === 'text').map((s) => s.value).join('');
    expect(text).toContain('$x$');
    expect(text).toContain('`$y$`');
  });

  it('keeps text without math intact', () => {
    expect(splitMathSegments('普通文字，无公式。')).toEqual([
      { type: 'text', value: '普通文字，无公式。' },
    ]);
  });

  it('ignores empty math regions', () => {
    expect(splitMathSegments('$$ $$  $ $')).toEqual([{ type: 'text', value: '$$ $$  $ $' }]);
  });
});

describe('cache keys', () => {
  it('keys on trimmed source, display mode, and config', () => {
    expect(formulaCacheKey(' E ', 'inline', 'cfg')).toBe('cfg::inline::E');
    expect(formulaCacheKey('E', 'display', 'cfg')).not.toBe(formulaCacheKey('E', 'inline', 'cfg'));
    expect(formulaCacheKey('E', 'inline', 'cfg1')).not.toBe(formulaCacheKey('E', 'inline', 'cfg2'));
  });

  it('mathConfigId reflects delimiter configuration', () => {
    expect(mathConfigId({ inlineMath: [['$', '$']], displayMath: [['$$', '$$']] })).toBe(
      '$$::$$$$'
    );
  });

  it('mathSignature changes only when math changes', () => {
    const base = 'a $x$ b';
    expect(mathSignature(base)).toBe(mathSignature('different text, same $x$ math'));
    expect(mathSignature(base)).not.toBe(mathSignature('a $y$ b'));
  });
});
