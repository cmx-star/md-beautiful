/**
 * Tests for the Phase 1-B Vault file-listening surface.
 *
 * - `vaultService.onChange` is verified by mocking `@tauri-apps/api/event`
 *   so the wrapper round-trip is exercised without a real Tauri runtime.
 * - `App.vue` watcher handler branches are verified through the same
 *   static-`?raw` source assertion style used by the Phase 1-A smoke
 *   tests, since this project does not depend on `@vue/test-utils`.
 *
 * No new runtime dependency is required.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import appSource from '../App.vue?raw';

// `vi.mock` factories are hoisted to the top of the file, so any state
// they need to reference must be declared via `vi.hoisted`.
const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

// Mock the Tauri event API.  The wrapper under test calls
// `listen('vault://changed', handler)` and forwards the payload.
vi.mock('@tauri-apps/api/event', () => {
  return {
    listen: vi.fn(),
  };
});

// Mock `@tauri-apps/api/core` so we can assert on the IPC command name
// without needing the Tauri runtime.
vi.mock('@tauri-apps/api/core', () => {
  return {
    invoke: mocks.invokeMock,
  };
});

import { listen } from '@tauri-apps/api/event';
import { vaultService } from './vaultService';

type ListenHandler = (event: { payload: unknown }) => void;

interface MockListenHandle {
  event: string;
  handler: ListenHandler;
}

const registered: MockListenHandle[] = [];

beforeEach(() => {
  registered.length = 0;
  (listen as unknown as Mock).mockReset();
  (listen as unknown as Mock).mockImplementation(
    async (event: string, handler: ListenHandler) => {
      registered.push({ event, handler });
      return () => {
        const idx = registered.findIndex((h) => h.handler === handler);
        if (idx >= 0) registered.splice(idx, 1);
      };
    }
  );
  mocks.invokeMock.mockReset();
  mocks.invokeMock.mockResolvedValue(undefined);
});

describe('vaultService.onChange wrapper', () => {
  it('subscribes to the vault://changed event', async () => {
    const cb = vi.fn();
    const unlisten = await vaultService.onChange(cb);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(registered[0].event).toBe('vault://changed');
    expect(typeof unlisten).toBe('function');
  });

  it('forwards the payload to the callback', async () => {
    const cb = vi.fn();
    await vaultService.onChange(cb);
    const handler = registered[0].handler;
    handler({ payload: { path: 'a.md', kind: 'modified', at: 1234 } });
    expect(cb).toHaveBeenCalledWith({ path: 'a.md', kind: 'modified', at: 1234 });
  });

  it('supports multiple subscribers and per-handler unlisten', async () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    const unlistenA = await vaultService.onChange(cbA);
    await vaultService.onChange(cbB);
    expect(registered).toHaveLength(2);

    unlistenA();
    expect(registered).toHaveLength(1);
    expect(registered[0].handler).toBeTypeOf('function');
  });

  it('closeVault dispatches the close_vault Tauri command', async () => {
    await vaultService.closeVault();
    expect(mocks.invokeMock).toHaveBeenCalledWith('close_vault');
  });
});

describe('App.vue (Vault watcher handler)', () => {
  const source = appSource;

  it('imports VaultChangeEvent and wires onChange after openVault', () => {
    expect(source).toMatch(/type VaultChangeEvent/);
    expect(source).toMatch(/vaultService\.onChange\(handleVaultChange\)/);
  });

  it('defines a handleVaultChange function with three branches', () => {
    expect(source).toMatch(/async function handleVaultChange/);
    expect(source).toMatch(/event\.kind === 'created' \|\| event\.kind === 'removed'/);
    // active note branch
    expect(source).toMatch(/activePath === event\.path/);
    // fallback silent refresh
    expect(source).toMatch(/\/\/ Non-active file: silent refresh\./);
  });

  it('renders an alertdialog titled "外部修改了当前笔记" with two buttons', () => {
    expect(source).toMatch(/role="alertdialog"/);
    expect(source).toMatch(/aria-label="外部修改了当前笔记"/);
    expect(source).toMatch(/data-testid="external-change-toast"/);
    expect(source).toMatch(/重新载入/);
    expect(source).toMatch(/保留我的编辑/);
  });

  it('never silently overwrites: reloading goes through vaultService.readFile', () => {
    expect(source).toMatch(/async function reloadActiveFromVault/);
    expect(source).toMatch(/vaultService\.readFile\(toast\.path\)/);
  });

  it('registers onChange after openVault and unlistens on unmount', () => {
    expect(source).toMatch(/unlistenVaultChange\.value = await vaultService\.onChange/);
    expect(source).toMatch(/if \(unlistenVaultChange\.value\)/);
    expect(source).toMatch(/unlistenVaultChange\.value\(\);/);
    expect(source).toMatch(/onBeforeUnmount/);
  });
});
