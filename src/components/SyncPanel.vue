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

  try {
    const nextCredential = credential.value.trim();
    if (nextCredential) {
      await credentialService.set(credentialKeys[type], nextCredential);
      syncStore.setCredentialStatus(type, true);
      credential.value = '';
    } else if (!provider.hasCredential) {
      throw new Error(type === 'github' ? '请先填写 GitHub Access Token' : '请先填写 WebDAV 密码');
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
