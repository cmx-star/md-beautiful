import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { collectHiddenMarks, isMarkNode } from './markHiding';

function makeView(doc: string, cursor: number): EditorView {
  const host = document.createElement('div');
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdown({ extensions: [GFM] }), EditorView.editable.of(true)],
  });
  return new EditorView({ state, parent: host });
}

function hiddenText(view: EditorView): string[] {
  const set = collectHiddenMarks(view);
  const out: string[] = [];
  const iter = set.iter();
  while (iter.value) {
    out.push(view.state.sliceDoc(iter.from, iter.to));
    iter.next();
  }
  return out;
}

describe('isMarkNode', () => {
  it('matches mark node names', () => {
    expect(isMarkNode('EmphasisMark')).toBe(true);
    expect(isMarkNode('HeaderMark')).toBe(true);
    expect(isMarkNode('CodeMark')).toBe(true);
    expect(isMarkNode('TaskMarker')).toBe(true);
    expect(isMarkNode('Paragraph')).toBe(false);
    expect(isMarkNode('Emphasis')).toBe(false);
  });
});

describe('collectHiddenMarks', () => {
  it('hides marks on lines without the cursor', () => {
    // Cursor sits on the empty middle line; heading and bold marks hide.
    const view = makeView('# 标题\n\n正文 **加粗** 结束\n', 5);
    const hidden = hiddenText(view);
    expect(hidden).toContain('#');
    expect(hidden).toContain('**');
  });

  it('keeps marks visible on the active line', () => {
    const view = makeView('# 标题\n\n正文 **加粗** 结束\n', 12);
    const hidden = hiddenText(view);
    expect(hidden).not.toContain('**');
  });

  it('hides task markers on inactive lines', () => {
    // Cursor sits on the empty middle line; the task marker above hides.
    const view = makeView('- [ ] 待办事项\n\n下一行\n', 11);
    const hidden = hiddenText(view);
    expect(hidden.some((t) => t.includes('['))).toBe(true);
  });
});
