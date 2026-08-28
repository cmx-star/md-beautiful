/**
 * CodeMirror command layer (Phase 2) — maps the pure transforms in
 * `markdownTransform.ts` onto editor ranges.  Line commands apply to every
 * line in the selection so multi-line toggles behave predictably.
 */

import type { Command } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import {
  codeBlock,
  mathBlock,
  toggleBlockQuote,
  toggleBulletList,
  toggleHeading,
  toggleLink,
  toggleNumberedList,
  toggleTaskDone,
  toggleWrap,
  type WrapTransform,
} from '@/utils/markdownTransform';

function applyToMainSelection(
  view: EditorView,
  transform: (selected: string) => WrapTransform
): boolean {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const t = transform(selected);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: t.insert },
    selection: {
      anchor: range.from + t.selectionStart,
      head: range.from + t.selectionEnd,
    },
    scrollIntoView: true,
  });
  return true;
}

function applyToSelectedLines(
  view: EditorView,
  transform: (line: string) => string
): boolean {
  const range = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(range.from);
  const toLine = view.state.doc.lineAt(range.to);
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (let n = fromLine.number; n <= toLine.number; n += 1) {
    const line = view.state.doc.line(n);
    const next = transform(line.text);
    if (next !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
  return true;
}

/** Insert a snippet at the cursor (or replace the selection). */
export function insertSnippet(view: EditorView, text: string): boolean {
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export const bold = (view: EditorView): boolean => applyToMainSelection(view, (s) => toggleWrap(s, '**'));
export const italic = (view: EditorView): boolean => applyToMainSelection(view, (s) => toggleWrap(s, '*'));
export const inlineCode = (view: EditorView): boolean => applyToMainSelection(view, (s) => toggleWrap(s, '`'));
export const link = (view: EditorView): boolean => applyToMainSelection(view, toggleLink);
export const heading1 = (view: EditorView): boolean => applyToSelectedLines(view, (l) => toggleHeading(l, 1));
export const heading2 = (view: EditorView): boolean => applyToSelectedLines(view, (l) => toggleHeading(l, 2));
export const heading3 = (view: EditorView): boolean => applyToSelectedLines(view, (l) => toggleHeading(l, 3));
export const blockQuote = (view: EditorView): boolean => applyToSelectedLines(view, toggleBlockQuote);
export const bulletList = (view: EditorView): boolean => applyToSelectedLines(view, toggleBulletList);
export const orderedList = (view: EditorView): boolean => applyToSelectedLines(view, toggleNumberedList);
export const taskList = (view: EditorView): boolean => applyToSelectedLines(view, toggleTaskDone);

/** Cycle the first selected line through 无标题 → H1 → H2 → H3 → 无标题. */
export function cycleHeading(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const current = line.text.match(/^(#{1,3})\s+/);
  const nextLevel = !current ? 1 : current[1].length === 3 ? 0 : current[1].length + 1;
  const next =
    nextLevel === 0
      ? line.text.replace(/^#{1,3}\s+/, '')
      : toggleHeading(line.text, nextLevel);
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  return true;
}

export const insertTable = (view: EditorView): boolean => insertSnippet(view, `\n${[
  '| 列1 | 列2 | 列3 |',
  '| --- | --- | --- |',
  '|  |  |  |',
].join('\n')}\n`);

export const insertCodeBlock = (view: EditorView): boolean =>
  insertSnippet(view, `\n${codeBlock()}`);

export const insertInlineMath = (view: EditorView): boolean =>
  applyToMainSelection(view, (s) => toggleWrap(s, '$'));

export const insertDisplayMath = (view: EditorView): boolean =>
  insertSnippet(view, `\n${mathBlock(true)}\n`);

export const insertHorizontalRule = (view: EditorView): boolean =>
  insertSnippet(view, '\n---\n');

/** Editor command ids shared with the shortcut registry (`fmt-*` actions). */
export const EDITOR_COMMANDS: Record<string, Command> = {
  'fmt-bold': bold,
  'fmt-italic': italic,
  'fmt-code': inlineCode,
  'fmt-link': link,
  'fmt-heading': cycleHeading,
  'fmt-quote': blockQuote,
  'fmt-bullet': bulletList,
  'fmt-ordered': orderedList,
  'fmt-task': taskList,
};
