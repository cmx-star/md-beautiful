import { defineStore } from 'pinia';
import type { SyncProvider } from '@/types';

const DEFAULT_PROVIDERS: Omit<SyncProvider, 'enabled' | 'lastSyncedAt' | 'isSyncing'>[] = [
  {
    type: 'gitlab',
    name: 'GitLab',
    config: { api_url: '', token: '', project_id: '', branch: 'main' },
  },
  {
    type: 'webdav',
    name: 'WebDAV / Nextcloud',
    config: { url: '', username: '', password: '' },
  },
];

export const useSyncStore = defineStore('sync', {
  state: () => ({
    providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, enabled: false })) as SyncProvider[],
    isSyncing: false as boolean,
    lastError: null as string | null,
    syncLog: [] as string[],
  }),
  actions: {
    addProvider(p: SyncProvider) {
      this.providers = [...this.providers.filter((x: SyncProvider) => x.type !== p.type), p];
    },
    updateConfig(type: SyncProvider['type'], config: Record<string, string>) {
      this.providers = this.providers.map((p: SyncProvider) =>
        p.type === type ? { ...p, config: { ...p.config, ...config } } : p
      );
    },
    toggleProvider(type: SyncProvider['type']) {
      this.providers = this.providers.map((p: SyncProvider) =>
        p.type === type ? { ...p, enabled: !p.enabled } : p
      );
    },
    async startSync() {
      this.isSyncing = true;
      this.lastError = null;
      const enabled = this.providers.filter((p: SyncProvider) => p.enabled);
      if (enabled.length === 0) {
        this.lastError = '没有启用任何同步服务';
        this.isSyncing = false;
        return;
      }
      for (const provider of enabled) {
        this.appendLog(`[${provider.name}] 开始同步...`);
        await new Promise((r) => setTimeout(r, 300));
        this.appendLog(`[${provider.name}] 同步完成。`);
      }
      this.isSyncing = false;
    },
    stopSync() {
      this.isSyncing = false;
    },
    setLastError(err: string | null) {
      this.lastError = err;
    },
    appendLog(msg: string) {
      this.syncLog = [msg, ...this.syncLog].slice(0, 50);
    },
  },
});
