<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { Codemirror } from 'vue-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { keymap, type KeyBinding } from '@codemirror/view';
import { EditorView } from 'codemirror';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { vaultService } from '@/services/vaultService';
import { documentService } from '@/services/documentService';
import {
  attachmentMarkdown,
  attachmentService,
} from '@/services/attachmentService';
import { EDITOR_COMMANDS } from '@/services/editorCommands';
import { appLogger } from '@/services/logger';
import { buildHighlightStyle } from '@/utils/highlightStyle';
import { extractFromContent } from '@/utils/noteIndex';
import { createMarkHiding } from '@/extensions/markHiding';
import { countMarkdownCharacters, deriveNoteTitle } from '@/utils/noteTitle';
import EmptyState from '@/components/EmptyState.vue';
import FormatBar from '@/components/FormatBar.vue';
import PropertiesPanel from '@/components/PropertiesPanel.vue';

const props = defineProps<{
  splitRatio: number;
  isResizing: boolean;
  /** 阅读模式下编辑器独占整行宽度。 */
  fullWidth: boolean;
}>();

const emit = defineEmits<{
  'resize-start': [];
  'resize-end': [];
  'split-change': [ratio: number];
  'editor-scroll': [ratio: number];
}>();

const store = useNoteStore();
const themeStore = useThemeStore();
const activeNote = computed(() => store.getActiveNote());
const saving = ref(false);
const saveError = ref('');
const content = ref('');
const dragOver = ref(false);
const showProperties = ref(false);
const editorRef = ref<{ view?: EditorView } | null>(null);
const editorSurface = ref<HTMLElement | null>(null);
const editorView = computed(
  () => (editorRef.value?.view as unknown as EditorView | undefined) ?? null
);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let unlistenDragDrop: (() => void) | null = null;

watch(
  () => activeNote.value?.id,
  (id) => {
    content.value = id
      ? store.notes.find((note) => note.id === id)?.content ?? ''
      : '';
  },
  { immediate: true }
);

async function onChange(newContent: string) {
  const note = activeNote.value;
  if (!note) return;
  if (debounceTimer) clearTimeout(debounceTimer);

  saveError.value = '';
  const wordCount = countMarkdownCharacters(newContent);
  store.updateNote(note.id, {
    title: deriveNoteTitle(newContent),
    content: newContent,
    wordCount,
    tags: extractFromContent(newContent).tags,
  });

  debounceTimer = setTimeout(async () => {
    saving.value = true;
    try {
      if (note.source?.kind === 'file') {
        await appLogger.debug('ui.file_save.started', 'source=file');
        await documentService.writeMarkdownFile(note.source.path, newContent);
        await appLogger.info('ui.file_save.completed', 'source=file');
      } else if (store.vaultRoot) {
        const relativePath = note.source?.kind === 'vault'
          ? note.source.path
          : `notes/${note.id}.md`;
        await appLogger.debug('ui.file_save.started', 'source=vault');
        await vaultService.writeFile(relativePath, newContent);
        await appLogger.info('ui.file_save.completed', 'source=vault');
      }
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error);
      await appLogger.error('ui.file_save.failed', error);
      console.error('Save failed:', error);
    } finally {
      saving.value = false;
    }
  }, 400);
}

// ── Attachments (Phase 1-C) ───────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Insert text at the caret; falls back to appending to the note. */
function insertAtCursor(text: string): void {
  const view = editorRef.value?.view;
  if (view) {
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: text } });
    view.focus();
    return;
  }
  const note = activeNote.value;
  if (note) store.updateNote(note.id, { content: note.content + text });
}

function requireVaultNote(): string | null {
  const note = activeNote.value;
  if (!note) return null;
  if (note.source?.kind !== 'vault' || !store.vaultRoot) {
    void appLogger.warn(
      'ui.attachment.skipped',
      'attachments require an open Vault and an active Vault note'
    );
    return null;
  }
  return note.source.path;
}

/** Write clipboard files into the Vault and insert links. Returns true when consumed. */
async function pasteAttachmentFiles(files: FileList): Promise<boolean> {
  const notePath = requireVaultNote();
  if (!notePath) return false;
  const links: string[] = [];
  for (const file of Array.from(files)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extension = EXT_BY_MIME[file.type] ?? file.name.split('.').pop() ?? 'bin';
      const name = file.name || `pasted-${Date.now()}.${extension}`;
      const info = await attachmentService.writeFromBytes(name, bytes);
      links.push(attachmentMarkdown(info, notePath));
      await appLogger.info('ui.attachment.pasted', `name=${info.name} size=${info.size}`);
    } catch (error) {
      await appLogger.error('ui.attachment.paste.failed', error);
    }
  }
  if (links.length > 0) insertAtCursor(`\n${links.join('\n')}\n`);
  return true;
}

async function importDroppedPaths(paths: string[]): Promise<void> {
  const notePath = requireVaultNote();
  if (!notePath) return;
  const links: string[] = [];
  for (const path of paths) {
    try {
      const info = await attachmentService.importFromPath(path);
      links.push(attachmentMarkdown(info, notePath));
      await appLogger.info('ui.attachment.imported', `name=${info.name} size=${info.size}`);
    } catch (error) {
      await appLogger.error('ui.attachment.import.failed', error);
    }
  }
  if (links.length > 0) insertAtCursor(`\n${links.join('\n')}\n`);
}

/** Convert physical drag coordinates to CSS px and test editor bounds. */
function dropInsideEditor(position?: { x: number; y: number }): boolean {
  if (!position) return true;
  const el = editorSurface.value;
  if (!el) return false;
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// ── Extensions ────────────────────────────────────────────────────────────────

/** Editor-scope keymap built from the shortcut registry (user-overridable). */
function buildEditorKeymap(): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const def of themeStore.shortcuts()) {
    if (def.scope !== 'editor') continue;
    const command = EDITOR_COMMANDS[def.id];
    if (!command) continue;
    for (const combo of def.keys) {
      bindings.push({ key: combo, run: command });
    }
  }
  return bindings;
}

const extensions = computed(() => [
  markdown({ extensions: [GFM] }),
  syntaxHighlighting(buildHighlightStyle(themeStore.activeHighlight())),
  EditorView.lineWrapping,
  EditorView.darkTheme.of(themeStore.isDark),
  keymap.of(buildEditorKeymap()),
  createMarkHiding(() => themeStore.hideMarks),
  EditorView.domEventHandlers({
    paste: (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) return false;
      event.preventDefault();
      void pasteAttachmentFiles(files);
      return true;
    },
    scroll: (_event: Event, view: EditorView) => {
      if (!themeStore.scrollSync) return false;
      const scroller = view.scrollDOM;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max > 0) emit('editor-scroll', scroller.scrollTop / max);
      return false;
    },
  }),
]);

onMounted(async () => {
  try {
    unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        dragOver.value = dropInsideEditor(event.payload.position);
      } else if (event.payload.type === 'drop') {
        const inside = dropInsideEditor(event.payload.position);
        dragOver.value = false;
        if (inside && event.payload.paths.length > 0) {
          void importDroppedPaths(event.payload.paths);
        }
      } else {
        dragOver.value = false;
      }
    });
  } catch (error) {
    // Drag-drop events can be unavailable in non-Tauri environments.
    await appLogger.warn('ui.attachment.dragdrop.unavailable', String(error));
  }
});

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (unlistenDragDrop) {
    unlistenDragDrop();
    unlistenDragDrop = null;
  }
});
</script>

<template>
  <section
    class="editor-pane"
    :style="{ width: props.fullWidth ? '100%' : `${props.splitRatio}%` }"
  >
    <div class="pane-caption">
      <span>Markdown</span>
      <span v-if="saving" class="save-state">保存中</span>
      <span v-else-if="saveError" class="save-error" :title="saveError">保存失败</span>
      <button
        type="button"
        class="pane-caption-button"
        :class="{ 'is-active': showProperties }"
        aria-label="属性面板"
        title="Frontmatter 属性"
        @click="showProperties = !showProperties"
      >
        属性
      </button>
    </div>
    <FormatBar :view="editorView" />
    <PropertiesPanel v-model:open="showProperties" />
    <div
      ref="editorSurface"
      class="editor-surface"
      :class="{ 'is-drag-over': dragOver }"
    >
      <Codemirror
        v-if="activeNote"
        ref="editorRef"
        v-model="content"
        :extensions="extensions"
        :style="{ height: '100%' }"
        class="cm-editor-custom"
        @change="onChange"
      />
      <EmptyState v-else />
    </div>
  </section>
</template>
