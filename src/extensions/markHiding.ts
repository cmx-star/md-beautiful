/**
 * Progressive markdown mark hiding (Phase 2).
 *
 * Syntax marks (`**`, `*`, `` ` ``, `#`, `>`, `- `, `[ ]`, link brackets…)
 * are hidden with `Decoration.replace` on lines that do NOT contain the
 * cursor.  Decorations never touch the document, so undo history, IME
 * composition, and selections stay intact; moving the cursor onto a line
 * reveals its raw marks again (Obsidian-style "live preview" behavior).
 */

import { Decoration, type DecorationSet } from '@codemirror/view';
import { ViewPlugin, EditorView } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

const hiddenMark = Decoration.replace({});

/** Lezer markdown mark nodes that should disappear on inactive lines. */
export function isMarkNode(name: string): boolean {
  return name.endsWith('Mark') || name === 'TaskMarker';
}

/**
 * Collect hidden ranges for the current view state.  Exported for tests —
 * the ViewPlugin below simply re-runs it on doc / selection changes.
 */
export function collectHiddenMarks(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const activeLines = new Set(
    view.state.selection.ranges.map((range) => doc.lineAt(range.head).number)
  );
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: Array<{ from: number; to: number }> = [];

  syntaxTree(view.state).iterate({
    from: 0,
    to: Math.min(doc.length, view.state.doc.length),
    enter: (node) => {
      if (!isMarkNode(node.name)) return;
      const line = doc.lineAt(node.from);
      if (activeLines.has(line.number)) return;
      ranges.push({ from: node.from, to: node.to });
    },
  });

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of ranges) {
    if (range.to > range.from) builder.add(range.from, range.to, hiddenMark);
  }
  return builder.finish();
}

export function createMarkHiding(enabled: () => boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = enabled() ? collectHiddenMarks(view) : Decoration.none;
      }

      update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; viewportChanged: boolean }) {
        if (!enabled()) {
          this.decorations = Decoration.none;
          return;
        }
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = collectHiddenMarks(update.view);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    }
  );
}
