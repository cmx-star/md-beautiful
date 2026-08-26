import { defineStore } from 'pinia';
import type { SyncProvider, SyncProviderType } from '@/types';

const DEFAULT_PROVIDERS: Omit<SyncProvider, 'enabled' | 'lastSyncedAt' | 'lastError'>[] = [
  {
    type: 'github',
    name: 'GitHub',
    config: { api_url: '', owner: '', repo: '', branch: 'main' },
    hasCredential: false,
  },
  {
    type: 'webdav',
    name: 'WebDAV / Nextcloud',
    config: { url: '', username: '' },
    hasCredential: false,
  },
];

export const useSyncStore = defineStore('sync', {
  state: () => ({
    providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, enabled: false })) as SyncProvider[],
    isSyncing: false as boolean,
    lastError: null as string | null,
    syncLog: [] as string[],
  }),
  getters: {
    /**
     * 是否至少有一个已启用且已配置凭据的同步服务。
     * Toolbar / SyncPanel 用来决定"开始同步"按钮是否可点击；
     * 在 Phase 0 这只用于禁用 UI，状态机本身尚未实现（见 DEVELOPMENT_PLAN_SUPPLEMENT.md §6）。
     */
    hasReadyProvider(state): boolean {
      return state.providers.some((p: SyncProvider) => {
        if (!p.enabled || !p.hasCredential) return false;
        if (p.type === 'github') {
          return Boolean(p.config.owner && p.config.repo && p.config.branch);
        }
        if (p.type === 'webdav') {
          return Boolean(p.config.url && p.config.username);
        }
        return false;
      });
    },
  },
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
    setCredentialStatus(type: SyncProviderType, hasCredential: boolean) {
      this.providers = this.providers.map((p: SyncProvider) =>
        p.type === type ? { ...p, hasCredential } : p
      );
    },
    async startSync() {
      this.isSyncing = true;
      this.lastError = null;
      const enabled = this.providers.filter((p: SyncProvider) => p.enabled);
      if (enabled.length === 0) {
        this.lastError = '未配置同步服务 — 请先在同步设置中启用并配置凭据';
        this.appendLog('[同步] 未启用任何同步服务，已跳过');
        this.isSyncing = false;
        return;
      }
      const configured = enabled.filter((p: SyncProvider) =>
        p.hasCredential && (
          p.type === 'github'
            ? p.config.owner && p.config.repo && p.config.branch
            : p.config.url && p.config.username
        )
      );
      if (configured.length === 0) {
        this.lastError = '已启用的同步服务缺少凭据，请填写完整配置';
        this.appendLog('[同步] 已启用的服务缺少凭据，已跳过');
        this.isSyncing = false;
        return;
      }
      this.appendLog('[同步] 同步状态机尚未实现 — 远端操作将在 Phase 4 开发');
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
