<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useNoteStore } from '@/stores/noteStore';
import {
  Cloud,
  Command,
  FileInput,
  FolderOpen,
  Moon,
  PanelLeft,
  RefreshCw,
  Sun,
} from 'lucide-vue-next';

defineProps<{
  sidebarOpen: boolean;
  isDark: boolean;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleTheme: [];
  sync: [];
  openFile: [];
  openPalette: [];
  openVault: [];
}>();

const syncStore = useSyncStore();
const noteStore = useNoteStore();
const isSyncing = computed(() => syncStore.isSyncing);
const syncReady = computed(() => syncStore.hasReadyProvider);
const syncBlockedReason = computed(() => {
  if (isSyncing.value) return '同步中…';
  if (!syncReady.value) return '同步状态机尚未实现（Phase 4）— 请先在同步设置中启用并配置凭据';
  return '同步';
});
const activeNote = computed(() => noteStore.getActiveNote());
</script>

<template>
  <header class="app-toolbar" data-tauri-drag-region>
    <div class="toolbar-leading">
      <button
        class="icon-button"
        :class="{ 'is-active': !sidebarOpen }"
        aria-label="切换侧边栏"
        title="切换侧边栏 (⌘B)"
        @click="$emit('toggleSidebar')"
      >
        <PanelLeft :size="18" />
      </button>
      <div class="toolbar-title">
        <strong>{{ activeNote?.title || 'Markdown Beautiful' }}</strong>
        <span>{{ activeNote ? `${activeNote.wordCount} 字` : 'Markdown workspace' }}</span>
      </div>
    </div>

    <div class="toolbar-actions">
      <button
        class="icon-button"
        aria-label="打开 Markdown 文件"
        title="打开 Markdown 文件 (⌘O)"
        @click="$emit('openFile')"
      >
        <FileInput :size="18" />
      </button>
      <button
        class="icon-button"
        aria-label="打开 Vault"
        :title="noteStore.vaultRoot ? '切换 Vault (⌘⇧O)' : '打开 Vault (⌘⇧O)'"
        @click="$emit('openVault')"
      >
        <FolderOpen :size="18" />
      </button>
      <button
        class="icon-button"
        :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
        :title="isDark ? '浅色模式' : '深色模式'"
        @click="$emit('toggleTheme')"
      >
        <Sun v-if="isDark" :size="18" />
        <Moon v-else :size="18" />
      </button>
      <button
        class="icon-button sync-button"
        :class="{ 'is-active': isSyncing, 'is-disabled': !syncReady || isSyncing }"
        :disabled="isSyncing || !syncReady"
        aria-label="同步"
        :title="syncBlockedReason"
        @click="$emit('sync')"
      >
        <RefreshCw v-if="isSyncing" :size="18" class="spin" />
        <Cloud v-else :size="18" />
      </button>
      <button
        class="command-button"
        aria-label="打开命令面板"
        title="命令面板 (⌘K)"
        @click="$emit('openPalette')"
      >
        <Command :size="15" />
        <kbd>⌘K</kbd>
      </button>
    </div>
  </header>
</template>
