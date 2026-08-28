import { defineStore } from 'pinia';
import type { SyncPhase, SyncProvider, SyncProviderType } from '@/types';
import { syncService, type ConflictDto, type PlanSummaryDto } from '@/services/syncService';
import { useNoteStore } from '@/stores/noteStore';
import { countMarkdownCharacters, deriveNoteTitle } from '@/utils/noteTitle';
import type { BaselineEntry } from '@/services/syncService';

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

export type ConflictResolution = 'keep-local' | 'keep-remote' | 'keep-both';

export const useSyncStore = defineStore('sync', {
  state: () => ({
    providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, enabled: false })) as SyncProvider[],
    isSyncing: false as boolean,
    lastError: null as string | null,
    syncLog: [] as string[],
    // ── Phase 4 state machine ──
    phase: 'idle' as SyncPhase,
    phaseMessage: '' as string,
    total: 0 as number,
    done: 0 as number,
    planSummary: null as PlanSummaryDto | null,
    activeProviderType: null as SyncProviderType | null,
    pendingConflicts: [] as ConflictDto[],
    pendingDeletions: [] as Array<{ path: string; kind: 'delete-local' | 'delete-remote' }>,
    cancelRequested: false as boolean,
    /** Baseline accumulated during the current run (applied actions only). */
    nextBaseline: {} as Record<string, BaselineEntry>,
  }),
  getters: {
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
    hasPendingDecisions(state): boolean {
      return state.pendingConflicts.length > 0 || state.pendingDeletions.length > 0;
    },
    configuredProviders(state): SyncProvider[] {
      return state.providers.filter((p: SyncProvider) =>
        p.hasCredential && (
          p.type === 'github'
            ? p.config.owner && p.config.repo && p.config.branch
            : p.config.url && p.config.username
        )
      );
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
    setLastError(err: string | null) {
      this.lastError = err;
    },
    appendLog(msg: string) {
      this.syncLog = [msg, ...this.syncLog].slice(0, 50);
    },
    stopSync() {
      if (this.isSyncing) this.cancelRequested = true;
    },

    /**
     * Run the sync state machine.  Never fabricates success: the baseline
     * only advances for actions that actually applied, conflicts and
     * destructive deletions are queued for explicit user decisions, and a
     * failure leaves the queue intact for a safe retry.
     */
    async startSync() {
      if (this.isSyncing) return;
      const enabled = this.providers.filter((p: SyncProvider) => p.enabled);
      if (enabled.length === 0) {
        this.lastError = '未配置同步服务 — 请先在同步设置中启用并配置凭据';
        this.appendLog('[同步] 未启用任何同步服务，已跳过');
        return;
      }
      if (enabled.length > 1) {
        // 计划 §3.1：同一 Vault 同时只允许一种应用内同步方式。
        this.lastError = '同一 Vault 只允许启用一种应用内同步方式，请关闭其余服务';
        this.appendLog('[同步] 检测到多个已启用服务，已拒绝执行');
        return;
      }
      const provider = this.configuredProviders.find(
        (p: SyncProvider) => p.type === enabled[0].type
      );
      if (!provider) {
        this.lastError = '已启用的同步服务缺少凭据，请填写完整配置';
        this.appendLog('[同步] 已启用的服务缺少凭据，已跳过');
        return;
      }

      const noteStore = useNoteStore();
      this.isSyncing = true;
      this.cancelRequested = false;
      this.lastError = null;
      this.activeProviderType = provider.type;
      this.pendingConflicts = [];
      this.pendingDeletions = [];
      this.planSummary = null;
      this.total = 0;
      this.done = 0;
      this.phase = 'planning';
      this.phaseMessage = '正在对比本地与远端状态…';
      this.appendLog(`[${provider.name}] 开始同步`);

      try {
        const plan = await syncService.buildPlan(provider);
        this.planSummary = plan.summary;
        this.total = plan.actions.filter((a) => a.kind !== 'noop').length;
        this.appendLog(
          `[${provider.name}] 计划生成：拉取 ${plan.summary.pull}，上传 ${plan.summary.upload}，` +
            `冲突 ${plan.summary.conflict}，删远端 ${plan.summary.deleteRemote}，删本地 ${plan.summary.deleteLocal}`
        );

        const nextBaseline: Record<string, BaselineEntry> = { ...plan.baseline };

        for (const action of plan.actions) {
          if (this.cancelRequested) {
            this.phase = 'cancelled';
            this.appendLog('[同步] 用户取消 — 已应用的动作保持有效，可安全重试');
            break;
          }
          if (action.kind === 'noop') continue;

          if (action.kind === 'pull') {
            this.phase = 'pulling';
            this.phaseMessage = `拉取 ${action.path}`;
            const resp = await syncService.pull(action.path, provider);
            nextBaseline[action.path] = { sha: resp.sha, etag: action.remoteEtag };
            await this.refreshLocalNote(action.path);
            this.done += 1;
          } else if (action.kind === 'upload') {
            this.phase = 'uploading';
            this.phaseMessage = `上传 ${action.path}`;
            const content = await syncService.readLocalFile(action.path);
            const resp = await syncService.upload(action.path, content, action.baseSha, provider);
            nextBaseline[action.path] = { sha: resp.sha, etag: resp.etag || '' };
            this.done += 1;
          } else if (action.kind === 'conflict') {
            this.phase = 'conflict';
            this.phaseMessage = '检测到冲突，等待处理';
            this.pendingConflicts.push(action.conflict);
            this.appendLog(`[冲突] ${action.conflict.path}（本地与远端均相对基线有修改）`);
          } else if (action.kind === 'delete-local' || action.kind === 'delete-remote') {
            this.phase = 'conflict';
            this.phaseMessage = '存在破坏性删除，等待确认';
            this.pendingDeletions.push({ path: action.path, kind: action.kind });
            this.appendLog(`[删除确认] ${action.kind === 'delete-local' ? '远端已删除，待删本地' : '本地已删除，待删远端'} ${action.path}`);
          }
        }

        this.nextBaseline = nextBaseline;
        if (this.phase !== 'cancelled' && !this.hasPendingDecisions) {
          await this.finalizeSync(nextBaseline);
        }
      } catch (error) {
        this.phase = 'error';
        this.lastError = error instanceof Error ? error.message : String(error);
        this.appendLog(`[同步] 失败：${this.lastError}`);
      } finally {
        this.isSyncing = false;
      }
    },

    /** Re-read a pulled file into the note store so the UI reflects remote. */
    async refreshLocalNote(path: string) {
      const noteStore = useNoteStore();
      const note = noteStore.notes.find(
        (n) => n.source?.kind === 'vault' && n.source.path === path
      );
      if (!note) return;
      const content = await syncService.readLocalFile(path);
      noteStore.updateNote(note.id, {
        content,
        title: deriveNoteTitle(content, note.title),
        wordCount: countMarkdownCharacters(content),
      });
    },

    async finalizeSync(baseline: Record<string, BaselineEntry>) {
      this.phase = 'finalizing';
      this.phaseMessage = '正在更新基线…';
      await syncService.saveBaseline(baseline);
      this.phase = 'done';
      this.phaseMessage = '同步完成';
      this.appendLog('[同步] 同步完成，基线已更新');
    },

    async resolveConflict(path: string, resolution: ConflictResolution) {
      const conflict = this.pendingConflicts.find((c) => c.path === path);
      if (!conflict) return;
      const provider = this.providers.find(
        (p) => p.type === this.activeProviderType
      );
      if (!provider) return;
      const baseline: Record<string, BaselineEntry> = this.nextBaseline;
      this.phase = 'conflict';
      this.phaseMessage = `处理冲突 ${path}（${resolution}）`;
      try {
        if (resolution === 'keep-local') {
          const resp = await syncService.upload(path, conflict.local, conflict.remoteSha || null, provider);
          baseline[path] = { sha: resp.sha, etag: resp.etag || '' };
          this.appendLog(`[冲突] ${path} 保留本地并上传`);
        } else if (resolution === 'keep-remote') {
          const resp = await syncService.pull(path, provider);
          baseline[path] = { sha: resp.sha, etag: conflict.remoteEtag || '' };
          await this.refreshLocalNote(path);
          this.appendLog(`[冲突] ${path} 采用远端版本`);
        } else {
          // keep-both：远端内容另存为本地副本，本地内容照常上传。
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const alt = path.replace(/(\.markdown|\.md)?$/i, '') + `.remote-${stamp}.md`;
          await syncService.writeLocalFile(alt, conflict.remote);
          const resp = await syncService.upload(path, conflict.local, conflict.remoteSha || null, provider);
          baseline[path] = { sha: resp.sha, etag: resp.etag || '' };
          this.appendLog(`[冲突] ${path} 双方保留（远端副本 → ${alt}）`);
        }
        this.pendingConflicts = this.pendingConflicts.filter((c) => c.path !== path);
        this.done += 1;
        if (!this.hasPendingDecisions) {
          await this.finalizeSync(baseline);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        this.appendLog(`[冲突] ${path} 处理失败：${message}`);
      }
    },

    async confirmDeletion(path: string) {
      const pending = this.pendingDeletions.find((d) => d.path === path);
      if (!pending) return;
      const provider = this.providers.find((p) => p.type === this.activeProviderType);
      if (!provider) return;
      const baseline: Record<string, BaselineEntry> = this.nextBaseline;
      try {
        if (pending.kind === 'delete-local') {
          await syncService.deleteLocal(path, provider);
          const noteStore = useNoteStore();
          const note = noteStore.notes.find(
            (n) => n.source?.kind === 'vault' && n.source.path === path
          );
          if (note) noteStore.deleteNote(note.id);
        } else {
          await syncService.deleteRemote(path, provider);
        }
        delete baseline[path];
        this.pendingDeletions = this.pendingDeletions.filter((d) => d.path !== path);
        this.appendLog(`[删除] ${path} 已确认删除（${pending.kind}）`);
        if (!this.hasPendingDecisions) {
          await this.finalizeSync(baseline);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        this.appendLog(`[删除] ${path} 失败：${message}`);
      }
    },

    /** Keep the file as-is; the decision will reappear on the next sync. */
    dismissDeletion(path: string) {
      this.pendingDeletions = this.pendingDeletions.filter((d) => d.path !== path);
      this.appendLog(`[删除] ${path} 已保留，未执行删除`);
      if (!this.hasPendingDecisions && this.phase === 'conflict') {
        void this.finalizeSync(this.nextBaseline);
      }
    },

    async cancelSync() {
      this.cancelRequested = true;
      this.appendLog('[同步] 取消请求已发出');
    },
  },
});
