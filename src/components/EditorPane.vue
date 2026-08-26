<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { Codemirror } from 'vue-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { EditorView } from 'codemirror';
import { vaultService } from '@/services/vaultService';
import { documentService } from '@/services/documentService';
import { appLogger } from '@/services/logger';
import { countMarkdownCharacters, deriveNoteTitle } from '@/utils/noteTitle';
import EmptyState from '@/components/EmptyState.vue';

const props = defineProps<{
  splitRatio: number;
  isResizing: boolean;
}>();

defineEmits<{
  'resize-start': [];
  'resize-end': [];
  'split-change': [ratio: number];
}>();

const store = useNoteStore();
const themeStore = useThemeStore();
const activeNote = computed(() => store.getActiveNote());
const saving = ref(false);
const saveError = ref('');
const content = ref('');
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

const extensions = computed(() => [
  markdown(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  EditorView.lineWrapping,
  EditorView.darkTheme.of(themeStore.isDark),
]);

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<template>
  <section class="editor-pane" :style="{ width: `${props.splitRatio}%` }">
    <div class="pane-caption">
      <span>Markdown</span>
      <span v-if="saving" class="save-state">保存中</span>
      <span v-else-if="saveError" class="save-error" :title="saveError">保存失败</span>
    </div>
    <div class="editor-surface">
      <Codemirror
        v-if="activeNote"
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
