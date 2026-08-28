<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { computed, shallowRef, watch } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { credentialService, type CredentialKey } from '@/services/credentialService';
import SyncCard from './SyncCard.vue';
import type { SyncProvider, SyncProviderType } from '@/types';
import { RefreshCw, X } from 'lucide-vue-next';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const syncStore = useSyncStore();

const githubProvider = computed(() => syncStore.providers.find((p: SyncProvider) => p.type === 'github')!);
const webdavProvider = computed(() => syncStore.providers.find((p: SyncProvider) => p.type === 'webdav')!);
const githubConnected = shallowRef(false);
const webdavConnected = shallowRef(false);
const githubCredential = shallowRef('');
const webdavCredential = shallowRef('');

const credentialKeys: Record<SyncProviderType, CredentialKey> = {
  github: 'github-token',
  webdav: 'webdav-password',
};

function toggleProvider(type: SyncProviderType) {
  syncStore.toggleProvider(type);
}

function updateConfig(type: SyncProviderType, config: Record<string, string>) {
  syncStore.updateConfig(type, config);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshCredentialStatus() {
  try {
    const [github, webdav] = await Promise.all([
      credentialService.has(credentialKeys.github),
      credentialService.has(credentialKeys.webdav),
    ]);
    syncStore.setCredentialStatus('github', github);
    syncStore.setCredentialStatus('webdav', webdav);
  } catch (error) {
    syncStore.setLastError(errorMessage(error));
  }
}

async function testProvider(type: SyncProviderType) {
  const provider = type === 'github' ? githubProvider.value : webdavProvider.value;
  const credential = type === 'github' ? githubCredential : webdavCredential;
  const connected = type === 'github' ? githubConnected : webdavConnected;

  // Phase 0 / DEVELOPMENT_PLAN_SUPPLEMENT.md §6: 前端拦截凭据缺失路径，
  // 防止静默触发 sync_test_connection 远端 HTTP。
  const credentialValue = credential.value.trim();
  if (!provider.hasCredential && !credentialValue) {
    const message = type === 'github' ? '请先填写 GitHub Access Token' : '请先填写 WebDAV 密码';
    syncStore.setLastError(message);
    syncStore.appendLog(`[${provider.name}] 凭据缺失，已拦截测试连接`);
    return;
  }

  try {
    if (credentialValue) {
      await credentialService.set(credentialKeys[type], credentialValue);
      syncStore.setCredentialStatus(type, true);
      credential.value = '';
    }

    await invoke('sync_test_connection', { provider });
    connected.value = true;
    syncStore.setLastError(null);
    syncStore.appendLog(`[${provider.name}] 连接成功`);
  } catch (error) {
    connected.value = false;
    syncStore.setLastError(errorMessage(error) || '连接失败');
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void refreshCredentialStatus();
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay">
      <button class="overlay-backdrop" aria-label="关闭同步设置" @click="emit('update:open', false)" />
      <section class="sync-dialog" role="dialog" aria-modal="true" aria-label="同步设置">
        <header class="dialog-header">
          <div class="dialog-title">
            <span class="dialog-title-icon"><RefreshCw :size="18" /></span>
            <div>
              <h2>同步设置</h2>
              <p>GitHub 与 WebDAV</p>
            </div>
          </div>
          <button class="icon-button" aria-label="关闭" title="关闭" @click="emit('update:open', false)">
            <X :size="18" />
          </button>
        </header>

        <div class="sync-dialog-body scrollbar-thin">
          <SyncCard
            :provider="githubProvider"
            :connected="githubConnected"
            :credential-value="githubCredential"
            @toggle="toggleProvider('github')"
            @test="testProvider('github')"
            @config-changed="updateConfig('github', $event)"
            @credential-changed="githubCredential = $event"
          />
          <SyncCard
            :provider="webdavProvider"
            :connected="webdavConnected"
            :credential-value="webdavCredential"
            @toggle="toggleProvider('webdav')"
            @test="testProvider('webdav')"
            @config-changed="updateConfig('webdav', $event)"
            @credential-changed="webdavCredential = $event"
          />

          <section v-if="syncStore.hasPendingDecisions" class="conflict-center" data-testid="conflict-center">
            <h3>冲突中心</h3>
            <p class="conflict-hint">
              以下文件需要人工决策。任何一方版本都不会被静默丢弃；处理后基线才会推进。
            </p>

            <article
              v-for="conflict in syncStore.pendingConflicts"
              :key="conflict.path"
              class="conflict-card"
            >
              <header>
                <strong>{{ conflict.path }}</strong>
                <span class="conflict-kind">双方均有修改</span>
              </header>
              <div class="conflict-panes">
                <div class="conflict-pane">
                  <h4>本地版本</h4>
                  <pre class="scrollbar-thin">{{ conflict.local }}</pre>
                </div>
                <div class="conflict-pane">
                  <h4>远端版本</h4>
                  <pre class="scrollbar-thin">{{ conflict.remote }}</pre>
                </div>
              </div>
              <div class="conflict-actions">
                <button type="button" @click="syncStore.resolveConflict(conflict.path, 'keep-local')">
                  保留本地（上传）
                </button>
                <button type="button" @click="syncStore.resolveConflict(conflict.path, 'keep-remote')">
                  采用远端（覆盖本地）
                </button>
                <button type="button" @click="syncStore.resolveConflict(conflict.path, 'keep-both')">
                  双方保留（另存副本）
                </button>
              </div>
            </article>

            <article
              v-for="deletion in syncStore.pendingDeletions"
              :key="deletion.path"
              class="conflict-card"
            >
              <header>
                <strong>{{ deletion.path }}</strong>
                <span class="conflict-kind">
                  {{ deletion.kind === 'delete-local' ? '远端已删除 — 是否删除本地文件？' : '本地已删除 — 是否删除远端文件？' }}
                </span>
              </header>
              <div class="conflict-actions">
                <button
                  type="button"
                  class="danger"
                  @click="syncStore.confirmDeletion(deletion.path)"
                >
                  确认删除
                </button>
                <button type="button" @click="syncStore.dismissDeletion(deletion.path)">
                  保留文件
                </button>
              </div>
            </article>
          </section>

          <section v-if="syncStore.isSyncing" class="sync-progress">
            <p>
              {{ syncStore.phaseMessage }}
              <span v-if="syncStore.total">（{{ syncStore.done }}/{{ syncStore.total }}）</span>
            </p>
            <button type="button" @click="syncStore.cancelSync()">取消</button>
          </section>

          <section v-if="syncStore.syncLog.length" class="sync-log">
            <h3>同步日志</h3>
            <div class="scrollbar-thin">
              <p v-for="(log, index) in syncStore.syncLog" :key="index">{{ log }}</p>
            </div>
          </section>

          <p v-if="syncStore.lastError" class="sync-error">{{ syncStore.lastError }}</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>
