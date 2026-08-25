<template>
  <div class="flex flex-col h-full relative" :style="{ width: `${splitRatio}%` }">
    <div class="flex-1 min-h-0 bg-[var(--bg-primary)] overflow-hidden">
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
    <!-- Resize handle removed — handled by PreviewPane -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { Codemirror } from 'vue-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { EditorView } from 'codemirror';

const props = defineProps<{
  splitRatio: number;
  isResizing: boolean;
}>();
const emit = defineEmits<{
  'resize-start': [];
  'resize-end': [];
  'split-change': [ratio: number];
}>();

const store = useNoteStore();
const themeStore = useThemeStore();
const activeNote = computed(() => store.getActiveNote());

const content = ref('');
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => activeNote.value?.id,
  (id) => {
    if (id) {
      content.value = store.notes.find((n) => n.id === id)?.content ?? '';
    }
  },
  { immediate: true }
);

function onChange(newContent: string) {
  const note = activeNote.value;
  if (!note) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const wordCount = newContent.trim().split(/\s+/).filter(Boolean).length;
    store.updateNote(note.id, { content: newContent, wordCount });
  }, 200);
}

const extensions = computed(() => [
  markdown(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  EditorView.lineWrapping,
  EditorView.darkTheme.of(themeStore.isDark),
]);

function startResize(e: MouseEvent) {
  e.preventDefault();
  emit('resize-start');
  const startX = e.clientX;
  const startRatio = props.splitRatio;
  const handleMouseMove = (ev: MouseEvent) => {
    const container = (ev.target as HTMLElement).closest('.flex')?.parentElement;
    const width = container?.clientWidth ?? 800;
    const delta = ev.clientX - startX;
    const newRatio = Math.min(90, Math.max(10, (startRatio * width + delta) / width));
    emit('split-change', newRatio);
    themeStore.setSplitRatio(newRatio);
  };
  const handleMouseUp = () => {
    emit('resize-end');
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<style scoped>
.cm-editor-custom {
  height: 100%;
  font-size: 14px;
  line-height: 1.7;
}
.cm-scroller {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}
.cm-content {
  padding: 24px;
  max-width: 72ch;
  margin: 0 auto;
}
.cm-gutters {
  background: var(--surface-card) !important;
  border-right: 1px solid var(--border-color);
  color: var(--text-tertiary) !important;
}
.cm-gutterElement {
  background: transparent !important;
  color: var(--text-tertiary) !important;
}
.cm-activeLineGutter {
  background: var(--bg-secondary) !important;
  color: var(--text-secondary) !important;
}
</style>
