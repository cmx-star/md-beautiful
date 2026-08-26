export interface Note {
  id: string;
  title: string;
  content: string;
  source?: NoteSource;
  folderId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  isFavorite: boolean;
}

export type NoteSource =
  | { kind: 'vault'; path: string }
  | { kind: 'file'; path: string };

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  createdAt: number;
}

export type SyncProviderType = 'github' | 'webdav';

export type SyncPhase =
  | 'idle'
  | 'planning'
  | 'pulling'
  | 'uploading'
  | 'conflict'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface SyncStatus {
  phase: SyncPhase;
  startedAt: number | null;
  updatedAt: number;
  total: number;
  done: number;
  message: string;
  conflicts: number;
  errors: number;
}

export type ConflictResolution = 'pending' | 'keep-local' | 'keep-remote' | 'keep-both';

export interface SyncConflict {
  path: string;
  kind: 'text-edit' | 'remote-only' | 'local-only' | 'deleted-remotely' | 'deleted-locally';
  baseContent: string;
  localContent: string;
  remoteContent: string;
  localMtime: number;
  remoteEtag: string;
  localSha: string;
  remoteSha: string;
  resolution: ConflictResolution;
}

export type SyncAction =
  | { kind: 'pull'; path: string; remoteEtag: string }
  | { kind: 'upload'; path: string; remoteEtag: string | null; baseSha: string | null }
  | { kind: 'delete-local'; path: string; remoteEtag: string }
  | { kind: 'delete-remote'; path: string; localSha: string }
  | { kind: 'noop'; path: string; reason: string }
  | { kind: 'conflict'; conflict: SyncConflict };

export interface SyncPlan {
  id: string;
  provider: SyncProviderType;
  createdAt: number;
  actions: SyncAction[];
  summary: {
    pull: number;
    upload: number;
    deleteLocal: number;
    deleteRemote: number;
    conflict: number;
    noop: number;
  };
}

export interface SyncResult {
  id: string;
  planId: string;
  provider: SyncProviderType;
  finishedAt: number;
  ok: boolean;
  applied: SyncAction[];
  failed: { path: string; error: string }[];
}

export interface SyncProvider {
  type: SyncProviderType;
  name: string;
  enabled: boolean;
  /**
   * 仅保存非敏感字段：url、username、repo、branch 等。
   * PAT / 密码 / token 永远不写入 store，而是通过 credentialService 存到系统 Keychain。
   */
  config: Record<string, string>;
  /**
   * 是否已在系统 Keychain 中保存凭据的标记。
   * true 表示有凭据可取，false 表示尚未配置。
   */
  hasCredential: boolean;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface SearchIndex {
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: number;
}

export type ViewMode = 'editor' | 'preview' | 'split';
export type SortMode = 'updated' | 'created' | 'name';
