<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useNoteStore } from '@/stores/noteStore';
import type { ViewMode } from '@/types';
import {
  BookOpen,
  Cloud,
  Columns2,
  Command,
  FileInput,
  FolderOpen,
  Link2,
  Link2Off,
  Moon,
  PanelLeft,
  PencilLine,
  RefreshCw,
  Settings,
  Sun,
} from 'lucide-vue-next';

defineProps<{
  sidebarOpen: boolean;
  isDark: boolean;
  viewMode: ViewMode;
  scrollSync: boolean;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleTheme: [];
  sync: [];
  openFile: [];
  openPalette: [];
  openVault: [];
  openSettings: [];
  setViewMode: [mode: ViewMode];
  toggleScrollSync: [];
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

const VIEW_OPTIONS: Array<{ mode: ViewMode; label: string; icon: typeof PencilLine }> = [
  { mode: 'editor', label: '源码模式 (⌘1)', icon: PencilLine },
  { mode: 'split', label: '实时预览 (⌘2)', icon: Columns2 },
  { mode: 'preview', label: '阅读模式 (⌘3)', icon: BookOpen },
];
</script>

<template>
  <header class="app-toolbar" data-tauri-drag-region>
    <div class="toolbar-leading">
      <button
        class="icon-button"
        :class="{ 'is-active': !sidebarOpen }"
        aria-label="切换侧边栏"
        title="切换侧边栏 (⌘\)"
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
      <div class="view-switch" role="group" aria-label="视图模式">
        <button
          v-for="option in VIEW_OPTIONS"
          :key="option.mode"
          class="icon-button view-option"
          :class="{ 'is-active': viewMode === option.mode }"
          :aria-label="option.label"
          :title="option.label"
          @click="$emit('setViewMode', option.mode)"
        >
          <component :is="option.icon" :size="16" />
        </button>
      </div>
      <button
        class="icon-button"
        :class="{ 'is-active': scrollSync }"
        :aria-label="scrollSync ? '关闭滚动同步' : '开启滚动同步'"
        :title="scrollSync ? '滚动同步（开）' : '滚动同步（关）'"
        @click="$emit('toggleScrollSync')"
      >
        <Link2 v-if="scrollSync" :size="18" />
        <Link2Off v-else :size="18" />
      </button>
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
        class="icon-button"
        aria-label="设置"
        title="设置（快捷键 / 语法高亮）"
        @click="$emit('openSettings')"
      >
        <Settings :size="18" />
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
