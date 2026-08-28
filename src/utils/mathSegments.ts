/**
 * Math segmentation for the cached formula pipeline (Phase 5).
 *
 * The preview pipeline splits the raw markdown into text / math segments,
 * renders each unique formula exactly once into an offscreen container
 * (cache key = tex source + display mode + config), and stitches the cached
 * SVG back into the preview.  Code blocks / inline code never yield math.
 */

export type MathDelimiter = 'inline' | 'display';

export interface ContentSegment {
  type: 'text' | 'math';
  value: string;
  display?: MathDelimiter;
}

const MATH_STARTERS = ['$$', '\\[', '\\(', '$'];

function matchMathAt(source: string, start: number): { raw: string; tex: string; display: MathDelimiter } | null {
  for (const opener of MATH_STARTERS) {
    if (!source.startsWith(opener, start)) continue;
    const isDisplay = opener === '$$' || opener === '\\[';
    const closer =
      opener === '$$' ? '$$' : opener === '\\[' ? '\\]' : opener === '\\(' ? '\\)' : '$';
    const end = source.indexOf(closer, start + opener.length);
    if (end === -1) continue;
    const tex = source.slice(start + opener.length, end);
    if (tex.trim() === '') continue;
    return {
      raw: source.slice(start, end + closer.length),
      tex,
      display: isDisplay ? 'display' : 'inline',
    };
  }
  return null;
}

/**
 * Split `content` into ordered text/math segments.  Fenced code blocks
 * (``` / ~~~) and inline code spans are treated as plain text.
 */
export function splitMathSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let text = '';
  let i = 0;
  let fence: string | null = null;

  const pushText = () => {
    if (text.length > 0) {
      segments.push({ type: 'text', value: text });
      text = '';
    }
  };

  while (i < content.length) {
    const atLineStart = i === 0 || content[i - 1] === '\n';

    if (atLineStart && (content.startsWith('```', i) || content.startsWith('~~~', i))) {
      const marker = content.slice(i, i + 3);
      if (fence === null) {
        fence = marker;
        text += marker;
        i += 3;
        continue;
      }
      if (marker === fence) {
        fence = null;
        text += marker;
        i += 3;
        continue;
      }
    }

    if (fence !== null) {
      text += content[i];
      i += 1;
      continue;
    }

    // Inline code spans (backtick runs) are opaque.
    if (content[i] === '`') {
      const run = /^`+/.exec(content.slice(i))![0];
      const closerIndex = content.indexOf(run, i + run.length);
      if (closerIndex !== -1) {
        text += content.slice(i, closerIndex + run.length);
        i = closerIndex + run.length;
        continue;
      }
      text += content[i];
      i += 1;
      continue;
    }

    const math = matchMathAt(content, i);
    if (math) {
      pushText();
      segments.push({ type: 'math', value: math.tex, display: math.display });
      i += math.raw.length;
      continue;
    }

    text += content[i];
    i += 1;
  }
  pushText();
  return segments;
}

/** Stable cache key for one formula (source + display mode + config id). */
export function formulaCacheKey(tex: string, display: MathDelimiter, configId: string): string {
  return `${configId}::${display}::${tex.trim()}`;
}

export function mathConfigId(config: { inlineMath: string[][]; displayMath: string[][] }): string {
  return `${config.inlineMath.map((d) => d.join('')).join('|')}::${config.displayMath
    .map((d) => d.join(''))
    .join('|')}`;
}

export function mathSignature(content: string): string {
  return splitMathSegments(content)
    .filter((s) => s.type === 'math')
    .map((s) => `${s.display}:${s.value}`)
    .join('\u0000');
}
