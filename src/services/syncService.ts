/**
 * Sync service — wires the front-end state machine to Tauri back-end commands.
 *
 * The state machine:
 *   idle → planning → pulling/uploading → (conflict) → finalizing → done | error | cancelled
 *
 * Plan construction happens in Rust (`sync_build_plan`), which diffs the
 * Vault against remote metadata and the persisted baseline.  The front-end
 * walks the plan: it applies pulls/uploads directly, and queues conflicts
 * and destructive deletions for explicit user confirmation (the conflict
 * center).  The baseline only advances for actions that actually succeeded,
 * so a failed PUT never fabricates a "synced" state.
 */

import type { SyncProvider } from '@/types';

export interface RemoteFileMeta {
  path: string;
  size: number;
  sha: string;
  etag?: string;
}

export interface BaselineEntry {
  sha: string;
  etag: string;
}

export interface ConflictDto {
  path: string;
  kind: string;
  base: string;
  local: string;
  remote: string;
  localMtime: number;
  remoteSha: string;
  remoteEtag: string;
  localSha: string;
}

export type PlanActionDto =
  | { kind: 'noop'; path: string; reason: string }
  | { kind: 'pull'; path: string; remoteSha: string; remoteEtag: string }
  | { kind: 'upload'; path: string; baseSha: string | null; remoteEtag: string | null }
  | { kind: 'delete-local'; path: string; remoteSha: string; remoteEtag: string }
  | { kind: 'delete-remote'; path: string; localSha: string }
  | { kind: 'conflict'; conflict: ConflictDto };

export interface PlanSummaryDto {
  pull: number;
  upload: number;
  deleteLocal: number;
  deleteRemote: number;
  conflict: number;
  noop: number;
}

export interface PulledFile {
  path: string;
  content: string;
  remoteSha: string;
  remoteEtag: string;
}

export interface BuildPlanResponse {
  planId: string;
  provider: string;
  actions: PlanActionDto[];
  summary: PlanSummaryDto;
  remoteMeta: RemoteFileMeta[];
  pulls: PulledFile[];
  remoteDeletions: { path: string; remoteEtag: string; remoteSha: string }[];
  baseline: Record<string, BaselineEntry>;
}

export type ApplyResponse = { sha: string; etag: string };

function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // @ts-expect-error Tauri global
  return window.__TAURI__.invoke(cmd, args);
}

/** Backend-facing provider DTO (credentials never leave Rust/keyring). */
export function providerDto(provider: SyncProvider): Record<string, unknown> {
  return {
    type: provider.type,
    name: provider.name,
    enabled: provider.enabled,
    config: provider.config,
    hasCredential: provider.hasCredential,
  };
}

export const syncService = {
  async buildPlan(provider: SyncProvider): Promise<BuildPlanResponse> {
    return invoke<BuildPlanResponse>('sync_build_plan', { provider: providerDto(provider) });
  },

  async pull(path: string, provider: SyncProvider): Promise<ApplyResponse> {
    return invoke<ApplyResponse>('sync_apply_action', {
      provider: providerDto(provider),
      action: { kind: 'pull', path },
    });
  },

  async upload(
    path: string,
    content: string,
    baseSha: string | null,
    provider: SyncProvider
  ): Promise<ApplyResponse> {
    return invoke<ApplyResponse>('sync_apply_action', {
      provider: providerDto(provider),
      action: { kind: 'upload', path, content, baseSha },
    });
  },

  async deleteLocal(path: string, provider: SyncProvider): Promise<ApplyResponse> {
    return invoke<ApplyResponse>('sync_apply_action', {
      provider: providerDto(provider),
      action: { kind: 'delete-local', path },
    });
  },

  async deleteRemote(path: string, provider: SyncProvider): Promise<ApplyResponse> {
    return invoke<ApplyResponse>('sync_apply_action', {
      provider: providerDto(provider),
      action: { kind: 'delete-remote', path },
    });
  },

  async readLocalFile(path: string): Promise<string> {
    return invoke<string>('vault_read_file', { relativePath: path });
  },

  async writeLocalFile(path: string, content: string): Promise<void> {
    await invoke<void>('vault_write_file', { relativePath: path, content });
  },

  async saveBaseline(baseline: Record<string, BaselineEntry>): Promise<void> {
    await invoke<void>('sync_save_baseline', { baseline });
  },

  async loadBaseline(): Promise<Record<string, BaselineEntry>> {
    return invoke<Record<string, BaselineEntry>>('sync_load_baseline');
  },
};
