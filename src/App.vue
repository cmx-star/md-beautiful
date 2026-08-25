<template>
  <div class="h-screen w-screen overflow-hidden flex flex-col" :class="{ dark: themeStore.isDark }">
    <div class="flex flex-1 min-h-0 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Sidebar :open="sidebarOpen" @toggle="sidebarOpen = !sidebarOpen" />
      <main class="flex flex-col flex-1 min-w-0">
        <Toolbar
          :sidebar-open="sidebarOpen"
          @toggle-sidebar="sidebarOpen = !sidebarOpen"
          :is-dark="themeStore.isDark"
          @toggle-theme="themeStore.toggleTheme()"
          @sync="handleSync"
          @open-palette="showPalette = true"
        />
        <div class="flex flex-1 min-h-0 relative">
          <EditorPane
            :split-ratio="splitRatio"
            :is-resizing="isResizing"
            @resize-start="isResizing = true"
            @resize-end="isResizing = false"
            @split-change="splitRatio = $event"
          />
          <PreviewPane
            :split-ratio="splitRatio"
            :is-resizing="isResizing"
            @resize-start="isResizing = true"
            @resize-end="isResizing = false"
            @split-change="splitRatio = $event"
          />
        </div>
      </main>
    </div>
    <CommandPalette v-if="showPalette" @close="showPalette = false" />
    <SyncPanel v-model:open="showSync" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { useSyncStore } from '@/stores/syncStore';
import Sidebar from '@/components/Sidebar.vue';
import Toolbar from '@/components/Toolbar.vue';
import EditorPane from '@/components/EditorPane.vue';
import PreviewPane from '@/components/PreviewPane.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import SyncPanel from '@/components/SyncPanel.vue';

const noteStore = useNoteStore();
const themeStore = useThemeStore();
const syncStore = useSyncStore();

const sidebarOpen = ref(noteStore.sidebarOpen ?? true);
const splitRatio = ref(themeStore.splitRatio);
const isResizing = ref(false);
const showPalette = ref(false);
const showSync = ref(false);

const handleSync = async () => {
  showSync.value = true;
  await syncStore.startSync();
};

onMounted(() => {
  themeStore.loadSettings();
});

// Global keyboard shortcuts
onMounted(() => {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      showPalette.value = true;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      sidebarOpen.value = !sidebarOpen.value;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      noteStore.addNote({
        id: crypto.randomUUID(),
        title: '无标题笔记',
        content: '',
        folderId: null,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordCount: 0,
        isFavorite: false,
      });
    }
  });
});
</script>
