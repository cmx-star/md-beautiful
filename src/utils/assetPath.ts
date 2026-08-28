/**
 * Attachment path helpers (Phase 1-C).
 *
 * Notes live at paths like `notes/foo/bar.md` and attachments live under
 * `assets/`.  These helpers translate between a note's Vault-relative path
 * and the relative links written into the Markdown body, so Git diffs stay
 * minimal and links keep working no matter how deeply the note is nested.
 */

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
]);

export function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Markdown link text that points from `notePath` to `assetPath`
 * (both Vault-relative).  `notes/a.md` + `assets/x.png` → `../assets/x.png`.
 */
export function relativeAssetLink(notePath: string, assetPath: string): string {
  const noteDir = notePath.includes('/')
    ? notePath.slice(0, notePath.lastIndexOf('/')).split('/')
    : [];
  const assetParts = assetPath.split('/').filter(Boolean);
  let common = 0;
  while (
    common < noteDir.length &&
    common < assetParts.length - 1 &&
    noteDir[common] === assetParts[common]
  ) {
    common += 1;
  }
  const ups = noteDir.length - common;
  const down = assetParts.slice(common).join('/');
  return (ups > 0 ? '../'.repeat(ups) : './') + down;
}

/**
 * Resolve an `<img src>`-style reference found inside the note at
 * `notePath` back to a Vault-relative asset path.  Returns `null` for
 * absolute URLs, data URLs, or references escaping the Vault.
 */
export function resolveAssetPath(notePath: string, src: string): string | null {
  if (/^(https?:|data:|blob:|asset:)/i.test(src)) return null;
  let rest = src.trim().replace(/^\.\//, '');
  const noteDir = notePath.includes('/')
    ? notePath.slice(0, notePath.lastIndexOf('/')).split('/')
    : [];
  let ups = 0;
  while (rest.startsWith('../')) {
    rest = rest.slice(3);
    ups += 1;
  }
  rest = rest.replace(/^\//, '');
  if (ups > noteDir.length) return null;
  const segments = [...noteDir.slice(0, noteDir.length - ups), ...rest.split('/')]
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.');
  if (segments.length === 0) return null;
  return segments.join('/');
}
