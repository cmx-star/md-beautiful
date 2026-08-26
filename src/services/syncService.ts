/**
 * Sync service — wires the front-end state machine to Tauri back-end commands.
 *
 * The state machine:
 *   idle → planning → pulling/uploading → (conflict) → finalizing → done | error | cancelled
 *
 * The plan is constructed by the back-end (which compares the Vault against
 * remote metadata). The front-end walks the plan, prompting the user whenever
 * a conflict appears, and writes results back to the back-end one file at a
 * time so a failed PUT never leaves the Vault in a half-uploaded state.
 */

import type {
  SyncAction,
  SyncConflict,
  SyncPlan,
  SyncProvider,
  SyncProviderType,
  SyncResult,
  SyncStatus,
} from '@/types';

export interface RemoteFileMeta {
  path: string;
  size: number;
  sha: string;
  etag?: string;
}

export interface BuildPlanResponse {
  plan: SyncPlan;
  pulls: { path: string; content: string; remoteEtag: string; remoteSha: string }[];
  remoteDeletions: { path: string; remoteEtag: string }[];
  baseline: Record<string, { sha: string; etag: string }>;
}

function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // @ts-expect-error Tauri global
  return window.__TAURI__.invoke(cmd, args);
}

export const syncService = {
  async buildPlan(provider: SyncProvider): Promise<BuildPlanResponse> {
    return invoke<BuildPlanResponse>('sync_build_plan', { provider });
  },

  async applyAction(
    provider: SyncProvider,
    action: SyncAction
  ): Promise<{ ok: true; etag?: string; sha?: string } | { ok: false; error: string }> {
    try {
      const result = await invoke<{ etag?: string; sha?: string }>('sync_apply_action', {
        provider,
        action,
      });
      return { ok: true, etag: result.etag, sha: result.sha };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async fetchRemoteMeta(provider: SyncProvider): Promise<RemoteFileMeta[]> {
    return invoke<RemoteFileMeta[]>('sync_list_remote', { provider });
  },

  async readLocalFile(path: string): Promise<string> {
    return invoke<string>('vault_read_file', { relativePath: path });
  },

  async writeLocalFile(path: string, content: string): Promise<void> {
    await invoke<void>('vault_write_file', { relativePath: path, content });
  },

  async deleteLocalFile(path: string): Promise<void> {
    await invoke<void>('vault_delete_file', { relativePath: path });
  },

  async loadBaseline(): Promise<Record<string, { sha: string; etag: string }>> {
    return invoke<Record<string, { sha: string; etag: string }>>('sync_load_baseline');
  },

  async saveBaseline(
    baseline: Record<string, { sha: string; etag: string }>
  ): Promise<void> {
    await invoke<void>('sync_save_baseline', { baseline });
  },
};

export const emptyStatus: SyncStatus = {
  phase: 'idle',
  startedAt: null,
  updatedAt: 0,
  total: 0,
  done: 0,
  message: '',
  conflicts: 0,
  errors: 0,
};

export function summarizePlan(actions: SyncAction[]): SyncPlan['summary'] {
  const summary = { pull: 0, upload: 0, deleteLocal: 0, deleteRemote: 0, conflict: 0, noop: 0 };
  for (const action of actions) {
    switch (action.kind) {
      case 'pull':
        summary.pull++;
        break;
      case 'upload':
        summary.upload++;
        break;
      case 'delete-local':
        summary.deleteLocal++;
        break;
      case 'delete-remote':
        summary.deleteRemote++;
        break;
      case 'conflict':
        summary.conflict++;
        break;
      case 'noop':
        summary.noop++;
        break;
    }
  }
  return summary;
}

export function isProviderType(value: string): value is SyncProviderType {
  return value === 'github' || value === 'webdav';
}

export function findConflict(plan: SyncPlan, path: string): SyncConflict | undefined {
  for (const action of plan.actions) {
    if (action.kind === 'conflict' && action.conflict.path === path) {
      return action.conflict;
    }
  }
  return undefined;
}

export function buildEmptyResult(plan: SyncPlan): SyncResult {
  return {
    id: crypto.randomUUID(),
    planId: plan.id,
    provider: plan.provider,
    finishedAt: 0,
    ok: true,
    applied: [],
    failed: [],
  };
}
