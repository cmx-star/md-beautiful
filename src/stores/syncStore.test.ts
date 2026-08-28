import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSyncStore } from './syncStore';
import { syncService, type BuildPlanResponse } from '@/services/syncService';

vi.mock('@/services/syncService', () => ({
  syncService: {
    buildPlan: vi.fn(),
    pull: vi.fn(),
    upload: vi.fn(),
    deleteLocal: vi.fn(),
    deleteRemote: vi.fn(),
    readLocalFile: vi.fn(),
    writeLocalFile: vi.fn(),
    saveBaseline: vi.fn(),
    loadBaseline: vi.fn(),
  },
}));

const mocked = vi.mocked(syncService);

function makeProvider(type: 'github' | 'webdav') {
  const store = useSyncStore();
  const provider = store.providers.find((p) => p.type === type)!;
  provider.enabled = true;
  provider.hasCredential = true;
  if (type === 'github') {
    provider.config = { api_url: '', owner: 'o', repo: 'r', branch: 'main' };
  } else {
    provider.config = { url: 'https://dav.example.com', username: 'u' };
  }
  return provider;
}

function planResponse(overrides: Partial<BuildPlanResponse>): BuildPlanResponse {
  return {
    planId: 'p1',
    provider: 'github',
    actions: [],
    summary: { pull: 0, upload: 0, deleteLocal: 0, deleteRemote: 0, conflict: 0, noop: 0 },
    remoteMeta: [],
    pulls: [],
    remoteDeletions: [],
    baseline: {},
    ...overrides,
  };
}

describe('sync state machine', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('refuses to run with more than one enabled provider', async () => {
    const store = useSyncStore();
    makeProvider('github');
    makeProvider('webdav');
    await store.startSync();
    expect(store.lastError).toContain('只允许启用一种');
    expect(syncService.buildPlan).not.toHaveBeenCalled();
  });

  it('refuses to run without credentials', async () => {
    const store = useSyncStore();
    const provider = store.providers.find((p) => p.type === 'github')!;
    provider.enabled = true;
    provider.hasCredential = false;
    await store.startSync();
    expect(store.lastError).toContain('缺少凭据');
  });

  it('applies pulls and uploads, then advances the baseline', async () => {
    const store = useSyncStore();
    makeProvider('github');
    mocked.buildPlan.mockResolvedValueOnce(
      planResponse({
        actions: [
          { kind: 'pull', path: 'notes/a.md', remoteSha: 'rsha-a', remoteEtag: '' },
          { kind: 'noop', path: 'notes/same.md', reason: 'identical' },
          { kind: 'upload', path: 'notes/b.md', baseSha: null, remoteEtag: null },
        ],
        summary: { pull: 1, upload: 1, deleteLocal: 0, deleteRemote: 0, conflict: 0, noop: 1 },
        baseline: { 'notes/b.md': { sha: 'old-b', etag: '' } },
      })
    );
    mocked.pull.mockResolvedValueOnce({ sha: 'new-a', etag: '' });
    mocked.readLocalFile.mockResolvedValueOnce('local b content');
    mocked.upload.mockResolvedValueOnce({ sha: 'new-b', etag: 'W/"2"' });

    await store.startSync();

    expect(syncService.pull).toHaveBeenCalledWith(
      'notes/a.md',
      expect.objectContaining({ type: 'github' })
    );
    expect(syncService.upload).toHaveBeenCalledWith(
      'notes/b.md',
      'local b content',
      null,
      expect.objectContaining({ type: 'github' })
    );
    expect(syncService.saveBaseline).toHaveBeenCalledWith({
      'notes/a.md': { sha: 'new-a', etag: '' },
      'notes/b.md': { sha: 'new-b', etag: 'W/"2"' },
    });
    expect(store.phase).toBe('done');
    expect(store.pendingConflicts).toHaveLength(0);
  });

  it('queues conflicts for user decisions and only finalizes after resolution', async () => {
    const store = useSyncStore();
    makeProvider('github');
    mocked.buildPlan.mockResolvedValueOnce(
      planResponse({
        actions: [
          {
            kind: 'conflict',
            conflict: {
              path: 'notes/c.md',
              kind: 'text-edit',
              base: 'base',
              local: 'local edit',
              remote: 'remote edit',
              localMtime: 1,
              remoteSha: 'remote-sha',
              remoteEtag: '',
              localSha: 'local-sha',
            },
          },
        ],
        summary: { pull: 0, upload: 0, deleteLocal: 0, deleteRemote: 0, conflict: 1, noop: 0 },
      })
    );

    await store.startSync();

    expect(store.phase).toBe('conflict');
    expect(store.pendingConflicts).toHaveLength(1);
    expect(syncService.saveBaseline).not.toHaveBeenCalled();

    mocked.upload.mockResolvedValueOnce({ sha: 'resolved-sha', etag: '' });
    await store.resolveConflict('notes/c.md', 'keep-local');

    expect(syncService.upload).toHaveBeenCalledWith(
      'notes/c.md',
      'local edit',
      'remote-sha',
      expect.objectContaining({ type: 'github' })
    );
    expect(syncService.saveBaseline).toHaveBeenCalledWith({
      'notes/c.md': { sha: 'resolved-sha', etag: '' },
    });
    expect(store.phase).toBe('done');
  });

  it('keep-both stores the remote copy locally and uploads the local side', async () => {
    const store = useSyncStore();
    makeProvider('github');
    mocked.buildPlan.mockResolvedValueOnce(
      planResponse({
        actions: [
          {
            kind: 'conflict',
            conflict: {
              path: 'notes/d.md',
              kind: 'text-edit',
              base: '',
              local: 'mine',
              remote: 'theirs',
              localMtime: 1,
              remoteSha: 'r',
              remoteEtag: '',
              localSha: 'l',
            },
          },
        ],
        summary: { pull: 0, upload: 0, deleteLocal: 0, deleteRemote: 0, conflict: 1, noop: 0 },
      })
    );
    await store.startSync();
    mocked.upload.mockResolvedValueOnce({ sha: 's2', etag: '' });
    await store.resolveConflict('notes/d.md', 'keep-both');

    expect(syncService.writeLocalFile).toHaveBeenCalledWith(
      expect.stringContaining('notes/d.remote-'),
      'theirs'
    );
    expect(syncService.upload).toHaveBeenCalledWith(
      'notes/d.md',
      'mine',
      'r',
      expect.anything()
    );
  });

  it('delete-remote requires explicit confirmation and removes the baseline entry', async () => {
    const store = useSyncStore();
    makeProvider('github');
    mocked.buildPlan.mockResolvedValueOnce(
      planResponse({
        actions: [{ kind: 'delete-remote', path: 'notes/gone.md', localSha: 'x' }],
        summary: { pull: 0, upload: 0, deleteLocal: 0, deleteRemote: 1, conflict: 0, noop: 0 },
        baseline: { 'notes/gone.md': { sha: 'x', etag: '' } },
      })
    );
    await store.startSync();
    expect(store.phase).toBe('conflict');
    expect(syncService.deleteRemote).not.toHaveBeenCalled();

    await store.confirmDeletion('notes/gone.md');
    expect(syncService.deleteRemote).toHaveBeenCalled();
    expect(syncService.saveBaseline).toHaveBeenCalledWith({});
    expect(store.phase).toBe('done');
  });
});
