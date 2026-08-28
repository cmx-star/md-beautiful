import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentMarkdown,
  attachmentService,
  bytesToBase64,
  MAX_ATTACHMENT_BYTES,
  mimeFromName,
  sanitizeFileName,
} from './attachmentService';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe('sanitizeFileName', () => {
  it('mirrors the Rust sanitizer', () => {
    expect(sanitizeFileName('photo.png')).toBe('photo.png');
    expect(sanitizeFileName('/etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a\\b\\c.txt')).toBe('c.txt');
    expect(sanitizeFileName('.hidden')).toBe('attachment');
    expect(sanitizeFileName('')).toBe('attachment');
    expect(sanitizeFileName('na\nme.png')).toBe('name.png');
  });
});

describe('bytesToBase64', () => {
  it('encodes utf-8 text round-trippably', () => {
    const bytes = new TextEncoder().encode('hello 附件');
    expect(atob(bytesToBase64(bytes))).toMatchObject;
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(decoded)).toBe('hello 附件');
  });

  it('handles chunks larger than 32 KiB', () => {
    const bytes = new Uint8Array(70_000).fill(7);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(70_000);
    expect(decoded[69_999]).toBe(7);
  });
});

describe('attachmentService', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it('importFromPath passes the source path through', async () => {
    mockedInvoke.mockResolvedValueOnce({ path: 'assets/a.png', name: 'a.png', size: 3 });
    const info = await attachmentService.importFromPath('/tmp/a.png');
    expect(mockedInvoke).toHaveBeenCalledWith('vault_import_attachment', {
      sourcePath: '/tmp/a.png',
    });
    expect(info.path).toBe('assets/a.png');
  });

  it('writeFromBytes encodes the payload as base64', async () => {
    mockedInvoke.mockResolvedValueOnce({ path: 'assets/b.png', name: 'b.png', size: 3 });
    const bytes = new TextEncoder().encode('abc');
    await attachmentService.writeFromBytes('b.png', bytes);
    const call = mockedInvoke.mock.calls[0];
    expect(call[0]).toBe('vault_write_attachment');
    expect(atob((call[1] as { dataBase64: string }).dataBase64)).toBe('abc');
  });

  it('writeFromBytes rejects oversized payloads locally', async () => {
    const bytes = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    await expect(attachmentService.writeFromBytes('big.bin', bytes)).rejects.toThrow(
      /超过大小限制/
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('readAsDataUrl builds a data URL with the right mime type', async () => {
    mockedInvoke.mockResolvedValueOnce({
      path: 'assets/a.png',
      name: 'a.png',
      dataBase64: bytesToBase64(new Uint8Array([1, 2, 3])),
    });
    const url = await attachmentService.readAsDataUrl('assets/a.png');
    expect(url).toBe(`data:image/png;base64,${bytesToBase64(new Uint8Array([1, 2, 3]))}`);
  });

  it('readAsDataUrlCached dedupes concurrent requests', async () => {
    let resolve!: (value: string) => void;
    mockedInvoke.mockImplementationOnce(
      () =>
        new Promise<{ path: string; name: string; dataBase64: string }>((res) => {
          resolve = () =>
            res({ path: 'assets/c.png', name: 'c.png', dataBase64: 'QQ==' });
        })
    );
    const first = attachmentService.readAsDataUrlCached('assets/c.png');
    const second = attachmentService.readAsDataUrlCached('assets/c.png');
    resolve('' as never);
    expect(await first).toBe(await second);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it('audit forwards to vault_audit_attachments', async () => {
    mockedInvoke.mockResolvedValueOnce({ total: 2, orphans: ['x.bin'] });
    const audit = await attachmentService.audit();
    expect(mockedInvoke).toHaveBeenCalledWith('vault_audit_attachments');
    expect(audit.orphans).toEqual(['x.bin']);
  });
});

describe('mimeFromName', () => {
  it('maps known extensions', () => {
    expect(mimeFromName('a.png')).toBe('image/png');
    expect(mimeFromName('a.svg')).toBe('image/svg+xml');
    expect(mimeFromName('a.pdf')).toBe('application/pdf');
  });

  it('falls back to octet-stream', () => {
    expect(mimeFromName('a.xyz')).toBe('application/octet-stream');
  });
});

describe('attachmentMarkdown', () => {
  it('embeds images', () => {
    expect(
      attachmentMarkdown({ path: 'assets/a.png', name: 'a.png', size: 1 }, 'notes/n.md')
    ).toBe('![](../assets/a.png)');
  });

  it('links non-images by file name', () => {
    expect(
      attachmentMarkdown({ path: 'assets/a.pdf', name: 'a.pdf', size: 1 }, 'n.md')
    ).toBe('[a.pdf](./assets/a.pdf)');
  });
});
