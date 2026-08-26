/**
 * Line-level diff utilities used by the conflict UI. The implementation is a
 * classic LCS-based diff that returns the smallest edit script for two text
 * blocks.  The output is consumed by the conflict panel to render side-by-side
 * diffs and to power "keep local / keep remote / keep both" actions.
 */

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  op: DiffOp;
  text: string;
  leftLine: number | null;
  rightLine: number | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/);
}

export function diffLines(left: string, right: string): DiffLine[] {
  const a = splitLines(left);
  const b = splitLines(right);
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ op: 'equal', text: a[i], leftLine: i + 1, rightLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ op: 'delete', text: a[i], leftLine: i + 1, rightLine: null });
      i++;
    } else {
      result.push({ op: 'insert', text: b[j], leftLine: null, rightLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    result.push({ op: 'delete', text: a[i], leftLine: i + 1, rightLine: null });
    i++;
  }
  while (j < m) {
    result.push({ op: 'insert', text: b[j], leftLine: null, rightLine: j + 1 });
    j++;
  }
  return result;
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, unchanged: 0 };
  for (const line of lines) {
    if (line.op === 'equal') summary.unchanged++;
    else if (line.op === 'insert') summary.added++;
    else summary.removed++;
  }
  return summary;
}

export interface ThreeWayMergeResult {
  ok: boolean;
  merged: string;
  conflicts: { start: number; end: number; ours: string; theirs: string }[];
}

const CONFLICT_START_OURS = '<<<<<<< OURS';
const CONFLICT_START_THEIRS = '<<<<<<< THEIRS';
const CONFLICT_SEP = '=======';
const CONFLICT_END = '>>>>>>>';

/**
 * Three-way merge using only the LCS-based line diff as a fallback.  A real
 * sync would use a structured diff with stable identifiers, but for Markdown
 * documents the line-level merge is sufficient and explicit when it fails.
 *
 * Returns the merged text plus a list of unresolved conflict regions.  The UI
 * then requires the user to pick "keep local / keep remote / keep both" before
 * the merged text is persisted.
 */
export function threeWayMerge(base: string, ours: string, theirs: string): ThreeWayMergeResult {
  if (ours === theirs) {
    return { ok: true, merged: ours, conflicts: [] };
  }
  if (base === ours) {
    return { ok: true, merged: theirs, conflicts: [] };
  }
  if (base === theirs) {
    return { ok: true, merged: ours, conflicts: [] };
  }

  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);

  const oursDiff = diffLines(base, ours);
  const theirsDiff = diffLines(base, theirs);

  const result: string[] = [];
  const conflicts: ThreeWayMergeResult['conflicts'] = [];

  let baseCursor = 0;
  let oCursor = 0;
  let tCursor = 0;

  const nextBaseFromOurs = (): { line: number; op: 'equal' | 'insert' | 'delete' } | null => {
    while (oCursor < oursDiff.length) {
      const cur = oursDiff[oCursor++];
      if (cur.op === 'equal') {
        if (cur.leftLine !== null) baseCursor = cur.leftLine;
        return { line: cur.leftLine ?? baseCursor, op: 'equal' };
      }
      if (cur.op === 'delete') return { line: cur.leftLine ?? baseCursor, op: 'delete' };
      if (cur.op === 'insert') return { line: -1, op: 'insert' };
    }
    return null;
  };
  const nextBaseFromTheirs = (): { line: number; op: 'equal' | 'insert' | 'delete' } | null => {
    while (tCursor < theirsDiff.length) {
      const cur = theirsDiff[tCursor++];
      if (cur.op === 'equal') {
        if (cur.leftLine !== null) baseCursor = cur.leftLine;
        return { line: cur.leftLine ?? baseCursor, op: 'equal' };
      }
      if (cur.op === 'delete') return { line: cur.leftLine ?? baseCursor, op: 'delete' };
      if (cur.op === 'insert') return { line: -1, op: 'insert' };
    }
    return null;
  };

  const collectRun = (
    diff: DiffLine[],
    cursor: { i: number },
    pred: (op: DiffOp) => boolean
  ): { ops: DiffLine[]; next: number } => {
    const ops: DiffLine[] = [];
    while (cursor.i < diff.length && pred(diff[cursor.i].op)) {
      ops.push(diff[cursor.i++]);
    }
    return { ops, next: cursor.i };
  };

  const oC = { i: 0 };
  const tC = { i: 0 };
  let baseIdx = 0;

  while (oC.i < oursDiff.length || tC.i < theirsDiff.length) {
    const o = oC.i < oursDiff.length ? oursDiff[oC.i] : null;
    const t = tC.i < theirsDiff.length ? theirsDiff[tC.i] : null;

    if (o && o.op === 'equal' && t && t.op === 'equal' && o.text === t.text) {
      result.push(o.text);
      oC.i++;
      tC.i++;
      if (o.leftLine !== null) baseIdx = o.leftLine;
      continue;
    }

    if (o && o.op === 'equal') {
      result.push(o.text);
      oC.i++;
      tC.i++;
      if (o.leftLine !== null) baseIdx = o.leftLine;
      continue;
    }

    if (t && t.op === 'equal') {
      result.push(t.text);
      oC.i++;
      tC.i++;
      if (t.leftLine !== null) baseIdx = t.leftLine;
      continue;
    }

    const oursRun = collectRun(oursDiff, oC, (op) => op !== 'equal');
    const theirsRun = collectRun(theirsDiff, tC, (op) => op !== 'equal');

    if (oursRun.ops.length === 0 && theirsRun.ops.length === 0) break;

    const oursText = oursRun.ops
      .filter((op) => op.op === 'insert' || op.op === 'delete')
      .map((op) => op.text)
      .join('\n');
    const theirsText = theirsRun.ops
      .filter((op) => op.op === 'insert' || op.op === 'delete')
      .map((op) => op.text)
      .join('\n');

    if (oursText === theirsText) {
      for (const op of oursRun.ops) {
        if (op.op === 'insert' || op.op === 'equal') result.push(op.text);
      }
      for (const op of theirsRun.ops) {
        if (op.op === 'insert' || op.op === 'equal') result.push(op.text);
      }
    } else {
      const start = result.length;
      result.push(CONFLICT_START_OURS);
      for (const op of oursRun.ops) {
        if (op.op === 'insert' || op.op === 'delete') result.push(op.text);
      }
      result.push(CONFLICT_SEP);
      for (const op of theirsRun.ops) {
        if (op.op === 'insert' || op.op === 'delete') result.push(op.text);
      }
      result.push(CONFLICT_END);
      conflicts.push({ start, end: result.length, ours: oursText, theirs: theirsText });
    }
    baseIdx++;
  }

  return { ok: conflicts.length === 0, merged: result.join('\n'), conflicts };
}
