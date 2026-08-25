<template>
  <header class="h-11 flex items-center px-3 bg-[var(--surface-card)] border-b border-[var(--border-color)] flex-shrink-0 gap-1">
    <!-- Sidebar toggle -->
    <button
      @click="$emit('toggleSidebar')"
      class="p-1.5 rounded-md transition-colors"
      :class="sidebarOpen ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'"
      title="切换侧边栏 (⌘B)"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          :d="sidebarOpen ? 'M3 4h10M3 8h7M3 12h10' : 'M3 4h10M3 8h10M3 12h10'"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <div class="w-px h-5 bg-[var(--border-color)] mx-1" />

    <!-- Theme toggle -->
    <button
      @click="$emit('toggleTheme')"
      class="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
      :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
    >
      <span class="text-base">{{ isDark ? '🌙' : '☀️' }}</span>
    </button>

    <div class="flex-1" />

    <!-- Sync -->
    <button
      @click="$emit('sync')"
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
      :class="isSyncing ? 'bg-[var(--accent)]/10 text-[var(--accent)] animate-pulse' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'"
    >
      <span>{{ isSyncing ? '🔄' : '☁️' }}</span>
      <span>{{ isSyncing ? '同步中…' : '同步' }}</span>
    </button>

    <!-- Command palette -->
    <button
      @click="$emit('openPalette')"
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs transition-colors"
      title="命令面板 (⌘K)"
    >
      <span>⌘K</span>
    </button>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';

defineProps<{
  sidebarOpen: boolean;
  isDark: boolean;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleTheme: [];
  sync: [];
  openPalette: [];
}>();

const syncStore = useSyncStore();
const isSyncing = computed(() => syncStore.isSyncing);
</script>
