<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { useSyncStore } from '@/stores/syncStore';
import { vaultService, type VaultChangeEvent } from '@/services/vaultService';
import { documentService } from '@/services/documentService';
import { appLogger } from '@/services/logger';
import { countMarkdownCharacters, deriveNoteTitle } from '@/utils/noteTitle';
import { runMigration, revertMigration } from '@/services/migrationService';
import { createTauriVaultAdapter } from '@/services/vaultAdapter';
import { clearDraft, listRecoverableDrafts } from '@/services/draftService';
import DataSettings from '@/components/Settings/DataSettings.vue';
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
const showDataSettings = shallowRef(false);
const draftRecoveryPrompt = ref<Array<{ noteId: string; ageMs: number }>>([]);
const vaultAdapter = shallowRef(createTauriVaultAdapter());
const isMacOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
const unlistenVaultChange = shallowRef<null | (() => void)>(null);
const externalChangeToast = ref<{ noteId: string; path: string } | null>(null);

function activeNotePath(): string | null {
  const active = noteStore.getActiveNote();
  if (!active) return null;
  const source = active.source as { kind?: string; path?: string } | undefined;
  if (source?.kind === 'vault' && typeof source.path === 'string') {
    return source.path;
  }
  return null;
}

async function refreshVaultList() {
  try {
    const files = await vaultService.listFiles();
    noteStore.setVaultFiles(files);
  } catch (error) {
    await appLogger.error('ui.vault_watch.refresh_failed', error);
  }
}

async function handleVaultChange(event: VaultChangeEvent) {
  await appLogger.info(
    'ui.vault_watch.changed',
    `path=${event.path} kind=${event.kind}`
  );
  if (event.kind === 'created' || event.kind === 'removed') {
    // Silent refresh — nothing to confirm.
    await refreshVaultList();
    return;
  }
  // event.kind === 'modified'
  const activePath = activeNotePath();
  if (activePath && activePath === event.path) {
    // Active note was modified externally — never silently overwrite.
    const active = noteStore.getActiveNote();
    if (active) {
      externalChangeToast.value = { noteId: active.id, path: event.path };
    } else {
      await refreshVaultList();
    }
    return;
  }
  // Non-active file: silent refresh.
  await refreshVaultList();
}

async function reloadActiveFromVault() {
  const toast = externalChangeToast.value;
  if (!toast) return;
  const active = noteStore.getActiveNote();
  if (!active || active.id !== toast.noteId) {
    externalChangeToast.value = null;
    return;
  }
  try {
    const content = await vaultService.readFile(toast.path);
    noteStore.updateNote(active.id, {
      content,
      wordCount: countMarkdownCharacters(content),
      title: deriveNoteTitle(content, active.title),
    });
    await appLogger.info('ui.vault_watch.reloaded', `path=${toast.path}`);
  } catch (error) {
    await appLogger.error('ui.vault_watch.reload_failed', error);
  } finally {
    externalChangeToast.value = null;
  }
}

function dismissExternalChangeToast() {
  // User chose to keep their in-editor edits; just clear the prompt.
  externalChangeToast.value = null;
  void appLogger.info('ui.vault_watch.kept_local_edits');
}

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
    // Drop any previous listener so re-opening a Vault doesn't double-fire.
    if (unlistenVaultChange.value) {
      unlistenVaultChange.value();
      unlistenVaultChange.value = null;
    }
    const files = await vaultService.openVault(root);
    // Register the watcher handler for the freshly opened vault.
    unlistenVaultChange.value = await vaultService.onChange(handleVaultChange);
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
    await maybeRunMigration();
    await maybePromptDraftRecovery();
  } catch (error) {
    await appLogger.error('ui.vault_open.failed', error);
    console.error('Vault open failed:', error);
  }
}

async function maybeRunMigration() {
  // Run only when there is at least one legacy entry.  Empty/no-key is a
  // no-op and we don't surface a UI signal for that.
  if (typeof localStorage === 'undefined') return;
  if (!localStorage.getItem('mardown-beautiful-notes')) return;
  try {
    const result = await runMigration(vaultAdapter.value);
    await appLogger.info(
      'ui.migration.completed',
      `imported=${result.imported.length} failed=${result.failed.length} cleared=${result.clearedLocalStorage}`
    );
    if (result.snapshotFile) {
      // Reload vault files so the new imported/ entries show up.
      const files = await vaultService.listFiles();
      noteStore.setVaultFiles(files);
    }
  } catch (error) {
    await appLogger.error('ui.migration.failed', error);
  }
}

async function maybePromptDraftRecovery() {
  if (typeof localStorage === 'undefined') return;
  const recoverable = listRecoverableDrafts();
  if (recoverable.length === 0) return;
  draftRecoveryPrompt.value = recoverable.map((d) => ({
    noteId: d.noteId,
    ageMs: d.ageMs,
  }));
  await appLogger.info('ui.drafts.recoverable', `count=${recoverable.length}`);
}

async function recoverDraft(noteId: string) {
  try {
    const draft = listRecoverableDrafts().find((d) => d.noteId === noteId);
    if (!draft) return;
    const targetNote = noteStore.notes.find((n) => n.id === noteId);
    if (!targetNote) {
      await appLogger.error('ui.drafts.recover.missing', `noteId=${noteId}`);
      return;
    }
    await vaultService.writeFile(targetNote.source?.path ?? '', draft.entry.content);
    clearDraft(noteId);
    draftRecoveryPrompt.value = draftRecoveryPrompt.value.filter(
      (d) => d.noteId !== noteId
    );
    await appLogger.info('ui.drafts.recover.completed', `noteId=${noteId}`);
  } catch (error) {
    await appLogger.error('ui.drafts.recover.failed', error);
  }
}

function discardDraft(noteId: string) {
  clearDraft(noteId);
  draftRecoveryPrompt.value = draftRecoveryPrompt.value.filter(
    (d) => d.noteId !== noteId
  );
  void appLogger.info('ui.drafts.discard', `noteId=${noteId}`);
}

async function handleRevert(snapshotFile: string) {
  try {
    await revertMigration(vaultAdapter.value, snapshotFile);
    const files = await vaultService.listFiles();
    noteStore.setVaultFiles(files);
    await appLogger.info('ui.migration.revert.completed', snapshotFile);
  } catch (error) {
    await appLogger.error('ui.migration.revert.failed', error);
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
  if (unlistenVaultChange.value) {
    unlistenVaultChange.value();
    unlistenVaultChange.value = null;
  }
  // Best-effort: ask the backend to drop its watcher.  Errors are
  // swallowed because the window is already being torn down.
  void vaultService.closeVault().catch(() => undefined);
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
      @open-data-settings="showDataSettings = true"
    />
    <SyncPanel v-model:open="showSync" />

    <section v-if="showDataSettings" class="data-settings-overlay" role="dialog" aria-label="笔记数据设置">
      <DataSettings
        :vault="vaultAdapter"
        @revert="handleRevert"
        @recover-draft="(p) => recoverDraft(p.noteId)"
      />
      <button type="button" class="close-button" @click="showDataSettings = false">关闭</button>
    </section>

    <section
      v-if="draftRecoveryPrompt.length"
      class="draft-recovery-dialog"
      role="alertdialog"
      aria-label="检测到未保存的草稿"
    >
      <h3>检测到未保存的草稿</h3>
      <p>是否恢复下列笔记的本地草稿？</p>
      <ul>
        <li v-for="d in draftRecoveryPrompt" :key="d.noteId">
          <code>{{ d.noteId }}</code>
          <span>{{ Math.round(d.ageMs / 1000) }}s ago</span>
          <button
            type="button"
            :aria-label="`恢复草稿 ${d.noteId}`"
            @click="recoverDraft(d.noteId)"
          >
            恢复（覆盖 Vault 内对应文件）
          </button>
          <button
            type="button"
            class="secondary"
            :aria-label="`仅查看草稿 ${d.noteId}`"
          >
            仅查看
          </button>
          <button
            type="button"
            class="secondary"
            :aria-label="`放弃草稿 ${d.noteId}`"
            @click="discardDraft(d.noteId)"
          >
            放弃
          </button>
        </li>
      </ul>
    </section>

    <section
      v-if="externalChangeToast"
      class="external-change-toast"
      role="alertdialog"
      aria-label="外部修改了当前笔记"
      data-testid="external-change-toast"
    >
      <p>外部修改了当前笔记：<code>{{ externalChangeToast.path }}</code></p>
      <button
        type="button"
        :aria-label="`重新载入 ${externalChangeToast.path}`"
        @click="reloadActiveFromVault"
      >
        重新载入
      </button>
      <button
        type="button"
        class="secondary"
        :aria-label="`保留我的编辑 ${externalChangeToast.path}`"
        @click="dismissExternalChangeToast"
      >
        保留我的编辑
      </button>
    </section>
  </div>
</template>
