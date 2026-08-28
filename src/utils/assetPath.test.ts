import { describe, expect, it } from 'vitest';
import {
  isImageName,
  relativeAssetLink,
  resolveAssetPath,
} from './assetPath';

describe('isImageName', () => {
  it('recognizes common image extensions', () => {
    expect(isImageName('photo.png')).toBe(true);
    expect(isImageName('photo.JPG')).toBe(true);
    expect(isImageName('diagram.svg')).toBe(true);
    expect(isImageName('clip.webp')).toBe(true);
  });

  it('rejects non-image files', () => {
    expect(isImageName('doc.pdf')).toBe(false);
    expect(isImageName('notes.md')).toBe(false);
    expect(isImageName('archive')).toBe(false);
  });
});

describe('relativeAssetLink', () => {
  it('uses ./ for root-level notes', () => {
    expect(relativeAssetLink('note.md', 'assets/x.png')).toBe('./assets/x.png');
  });

  it('climbs out of the note directory', () => {
    expect(relativeAssetLink('notes/a.md', 'assets/x.png')).toBe('../assets/x.png');
  });

  it('climbs multiple levels', () => {
    expect(relativeAssetLink('notes/deep/a.md', 'assets/x.png')).toBe('../../assets/x.png');
  });

  it('stays relative within the same subtree', () => {
    expect(relativeAssetLink('notes/a.md', 'notes/assets/x.png')).toBe('./assets/x.png');
  });
});

describe('resolveAssetPath', () => {
  it('resolves sibling references', () => {
    expect(resolveAssetPath('note.md', 'assets/x.png')).toBe('assets/x.png');
  });

  it('resolves ../ references from nested notes', () => {
    expect(resolveAssetPath('notes/a.md', '../assets/x.png')).toBe('assets/x.png');
  });

  it('resolves ./ references', () => {
    expect(resolveAssetPath('notes/a.md', './assets/x.png')).toBe('notes/assets/x.png');
  });

  it('rejects absolute and remote URLs', () => {
    expect(resolveAssetPath('a.md', 'https://example.com/x.png')).toBeNull();
    expect(resolveAssetPath('a.md', 'data:image/png;base64,AAA')).toBeNull();
    expect(resolveAssetPath('a.md', 'blob:xyz')).toBeNull();
  });

  it('rejects references escaping the vault', () => {
    expect(resolveAssetPath('a.md', '../../../etc/passwd')).toBeNull();
  });

  it('rejects empty results', () => {
    expect(resolveAssetPath('a.md', '')).toBeNull();
  });
});
