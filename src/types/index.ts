export interface Note {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  isFavorite: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  createdAt: number;
}

export interface SyncProvider {
  type: 'gitlab' | 'webdav' | 'local';
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  lastSyncedAt?: number;
  isSyncing?: boolean;
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
