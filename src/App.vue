<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { useSyncStore } from '@/stores/syncStore';
import { vaultService } from '@/services/vaultService';
import { documentService } from '@/services/documentService';
import { appLogger } from '@/services/logger';
import { countMarkdownCharacters, deriveNoteTitle } from '@/utils/noteTitle';
import Sidebar from '@/components/Sidebar.vue';
import Toolbar from '@/components/Toolbar.vue';
import EditorPane from '@/components/EditorPane.vue';
import PreviewPane from '@/components/PreviewPane.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import SyncPanel from '@/components/SyncPanel.vue';

const noteStore = useNoteStore();
const themeStore = useThemeStore();
const syncStore = useSyncStore();

const sidebarOpen = shallowRef(noteStore.sidebarOpen ?? true);
const splitRatio = shallowRef(themeStore.splitRatio);
const isResizing = shallowRef(false);
const showPalette = shallowRef(false);
const showSync = shallowRef(false);
const isMacOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
  noteStore.sidebarOpen = sidebarOpen.value;
}

function handleSplitChange(ratio: number) {
  splitRatio.value = ratio;
  themeStore.setSplitRatio(ratio);
}

async function handleSync() {
  showSync.value = true;
  await syncStore.startSync();
}

async function openVaultPicker() {
  try {
    await appLogger.info('ui.vault_picker.requested');
    // @ts-expect-error Tauri dialog global
    const selected = await window.__TAURI__.dialog.open({
      directory: true,
      multiple: false,
      title: '选择 Vault 目录',
    });
    if (!selected) {
      await appLogger.info('ui.vault_picker.cancelled');
      return;
    }
    const root = Array.isArray(selected) ? selected[0] : selected;
    if (typeof root === 'string') await openVault(root);
  } catch (error) {
    await appLogger.error('ui.vault_picker.failed', error);
    console.error('Vault open failed:', error);
  }
}

async function openVault(root: string) {
  try {
    await appLogger.info('ui.vault_open.started');
    const files = await vaultService.openVault(root);
    noteStore.setVaultRoot(root);
    noteStore.setVaultFiles(files);
    const notes = [];
    for (const file of files) {
      try {
        const content = await vaultService.readFile(file.path);
        notes.push({
          id: file.path.replace(/\.md$/, '').replace(/\//g, '-'),
          title: deriveNoteTitle(content, file.name.replace(/\.md$/, '')),
          content,
          source: { kind: 'vault' as const, path: file.path },
          folderId: null,
          tags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          wordCount: countMarkdownCharacters(content),
          isFavorite: false,
        });
      } catch (error) {
        await appLogger.error('ui.vault_file_read.failed', error);
        console.warn(`Failed to read ${file.path}:`, error);
      }
    }
    noteStore.setNotes(notes);
    if (notes.length > 0) noteStore.setActiveNote(notes[0].id);
    await appLogger.info(
      'ui.vault_open.completed',
      `files=${files.length} loaded=${notes.length}`
    );
  } catch (error) {
    await appLogger.error('ui.vault_open.failed', error);
    console.error('Vault open failed:', error);
  }
}

async function openMarkdownFile() {
  try {
    await appLogger.info('ui.file_picker.requested');
    const opened = await documentService.pickMarkdownFile();
    if (!opened) {
      await appLogger.info('ui.file_picker.cancelled');
      return;
    }
    await appLogger.info(
      'ui.file_open.received',
      `name=${opened.name} size=${opened.size}`
    );

    const existing = noteStore.notes.find(
      (note) => note.source?.kind === 'file' && note.source.path === opened.path
    );
    const updates = {
      title: deriveNoteTitle(opened.content, opened.name.replace(/\.(md|markdown)$/i, '')),
      content: opened.content,
      source: { kind: 'file' as const, path: opened.path },
      wordCount: countMarkdownCharacters(opened.content),
    };

    if (existing) {
      noteStore.updateNote(existing.id, updates);
      noteStore.setActiveNote(existing.id);
      await appLogger.info(
        'ui.file_open.completed',
        `name=${opened.name} size=${opened.size} reused=true`
      );
      return;
    }

    const id = crypto.randomUUID();
    noteStore.addNote({
      id,
      ...updates,
      folderId: null,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isFavorite: false,
    });
    noteStore.setActiveNote(id);
    await appLogger.info(
      'ui.file_open.completed',
      `name=${opened.name} size=${opened.size} reused=false`
    );
  } catch (error) {
    await appLogger.error('ui.file_open.failed', error);
    console.error('Markdown file open failed:', error);
  }
}

function createNote() {
  const id = crypto.randomUUID();
  noteStore.addNote({
    id,
    title: '无标题笔记',
    content: '',
    folderId: null,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: 0,
    isFavorite: false,
  });
  noteStore.setActiveNote(id);
}

function handleKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey)) return;

  if (event.key.toLowerCase() === 'k') {
    event.preventDefault();
    showPalette.value = true;
  } else if (event.key.toLowerCase() === 'b') {
    event.preventDefault();
    toggleSidebar();
  } else if (event.key.toLowerCase() === 'n') {
    event.preventDefault();
    createNote();
  } else if (event.key.toLowerCase() === 'o') {
    event.preventDefault();
    if (event.shiftKey) {
      openVaultPicker();
    } else {
      openMarkdownFile();
    }
  }
}

onMounted(() => {
  themeStore.loadSettings();
  splitRatio.value = themeStore.splitRatio;
  noteStore.notes.forEach((note) => {
    note.title = deriveNoteTitle(note.content, note.title);
    note.wordCount = countMarkdownCharacters(note.content);
  });
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="app-shell" :class="{ dark: themeStore.isDark, 'is-resizing': isResizing }">
    <div v-if="isMacOS" class="native-titlebar" data-tauri-drag-region aria-hidden="true" />
    <div class="workspace-shell">
      <Sidebar
        :open="sidebarOpen"
        @toggle="toggleSidebar"
        @open-vault="openVaultPicker"
      />
      <main class="workspace-main">
        <Toolbar
          :sidebar-open="sidebarOpen"
          :is-dark="themeStore.isDark"
          @toggle-sidebar="toggleSidebar"
          @toggle-theme="themeStore.toggleTheme()"
          @sync="handleSync"
          @open-file="openMarkdownFile"
          @open-palette="showPalette = true"
          @open-vault="openVaultPicker"
        />
        <div class="workspace-panes">
          <EditorPane
            :split-ratio="splitRatio"
            :is-resizing="isResizing"
            @resize-start="isResizing = true"
            @resize-end="isResizing = false"
            @split-change="handleSplitChange"
          />
          <PreviewPane
            :split-ratio="splitRatio"
            :is-resizing="isResizing"
            @resize-start="isResizing = true"
            @resize-end="isResizing = false"
            @split-change="handleSplitChange"
          />
        </div>
      </main>
    </div>
    <CommandPalette
      v-if="showPalette"
      @close="showPalette = false"
      @open-file="openMarkdownFile"
      @open-vault="openVaultPicker"
      @new-note="createNote"
      @toggle-theme="themeStore.toggleTheme()"
      @toggle-sidebar="toggleSidebar"
      @sync="handleSync"
    />
    <SyncPanel v-model:open="showSync" />
  </div>
</template>
