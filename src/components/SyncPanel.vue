<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-40 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('update:open', false)" />
      <div class="relative w-full max-w-lg bg-[var(--surface-card)] border border-[var(--border-color)] rounded-xl shadow-2xl p-6 animate-zoom-in m-4">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-[var(--text-primary)]">同步设置</h2>
          <button @click="emit('update:open', false)" class="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg leading-none">&times;</button>
        </div>

        <!-- GitLab -->
        <SyncCard
          :provider="gitlabProvider"
          :connected="gitlabConnected"
          @toggle="toggleProvider('gitlab')"
          @test="testGitlab"
          @config-changed="updateConfig('gitlab', $event)"
        />

        <!-- WebDAV -->
        <SyncCard
          :provider="webdavProvider"
          :connected="webdavConnected"
          @toggle="toggleProvider('webdav')"
          @test="testWebdav"
          @config-changed="updateConfig('webdav', $event)"
        />

        <!-- Log -->
        <div v-if="syncStore.syncLog.length" class="mt-4 pt-4 border-t border-[var(--border-color)]">
          <div class="text-xs text-[var(--text-tertiary)] mb-2">同步日志</div>
          <div class="max-h-32 overflow-y-auto scrollbar-thin text-xs font-mono text-[var(--text-secondary)] space-y-0.5">
            <div v-for="(log, i) in syncStore.syncLog" :key="i">{{ log }}</div>
          </div>
        </div>

        <div v-if="syncStore.lastError" class="mt-3 text-xs text-red-500">
          {{ syncStore.lastError }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import SyncCard from './SyncCard.vue';
import type { SyncProvider } from '@/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const syncStore = useSyncStore();

const gitlabProvider = computed(() => syncStore.providers.find((p: SyncProvider) => p.type === 'gitlab')!);
const webdavProvider = computed(() => syncStore.providers.find((p: SyncProvider) => p.type === 'webdav')!);
const gitlabConnected = ref(false);
const webdavConnected = ref(false);

function toggleProvider(type: 'gitlab' | 'webdav') {
  syncStore.toggleProvider(type);
}

function updateConfig(type: 'gitlab' | 'webdav', config: Record<string, string>) {
  syncStore.updateConfig(type, config);
}

async function testGitlab() {
  const p = gitlabProvider.value;
  try {
    // @ts-expect-error Tauri command
    await window.__TAURI__.invoke('test_gitlab', { config: p.config });
    gitlabConnected.value = true;
    syncStore.appendLog('[GitLab] 连接成功');
  } catch (e: any) {
    gitlabConnected.value = false;
    syncStore.setLastError(e?.message || '连接失败');
  }
}

async function testWebdav() {
  const p = webdavProvider.value;
  try {
    // @ts-expect-error Tauri command
    await window.__TAURI__.invoke('test_webdav', { config: p.config });
    webdavConnected.value = true;
    syncStore.appendLog('[WebDAV] 连接成功');
  } catch (e: any) {
    webdavConnected.value = false;
    syncStore.setLastError(e?.message || '连接失败');
  }
}
</script>
