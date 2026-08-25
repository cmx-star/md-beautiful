<template>
  <div
    class="flex flex-col h-full overflow-hidden"
    :style="{ width: `${100 - splitRatio}%` }"
  >
    <div class="flex-1 overflow-y-auto editor-scroll p-8">
      <div v-if="activeNote" class="max-w-3xl mx-auto">
        <h1 class="text-2xl font-bold mb-3 text-[var(--text-primary)]">
          {{ activeNote.title }}
        </h1>
        <div class="flex items-center gap-3 mb-5 text-xs text-[var(--text-tertiary)] pb-4 border-b border-[var(--border-color)]">
          <span>{{ formatTime(activeNote.updatedAt) }}</span>
          <span>·</span>
          <span>{{ activeNote.wordCount }} 字</span>
          <span v-if="activeNote.tags.length" class="flex gap-1">
            <span
              v-for="tag in activeNote.tags"
              :key="tag"
              class="px-1.5 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] rounded"
            >#{{ tag }}</span>
          </span>
        </div>
        <div
          ref="previewRef"
          class="markdown-preview prose prose-sm max-w-none text-[var(--text-primary)] leading-relaxed"
        />
      </div>
      <EmptyState v-else />
    </div>

    <!-- Resize handle -->
    <div
      class="pane-divider absolute top-0 bottom-0 right-0 z-10"
      @mousedown="startResize"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { marked } from 'marked';

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
const activeNote = computed(() => store.getActiveNote());
const previewRef = ref<HTMLElement | null>(null);
let lastRenderedContent = '';

watch(
  () => activeNote.value?.content,
  async (content) => {
    if (!content) return;
    if (content === lastRenderedContent) return;
    lastRenderedContent = content;

    marked.setOptions({ gfm: true, breaks: true });
    const html = (marked.parse(content) as string) ?? '';

    await nextTick();
    if (!previewRef.value) return;

    // Clear any previous MathJax containers before re-rendering to prevent duplicates
    const containers = previewRef.value.querySelectorAll('mjx-container');
    containers.forEach((el) => el.remove());

    previewRef.value.innerHTML = html;
    await nextTick();
    renderMathJax();
  },
  { immediate: true }
);

function renderMathJax() {
  if (!previewRef.value) return;
  const mj = window.MathJax;
  if (!mj) return;
  try {
    mj.typesetPromise([previewRef.value]).catch(() => {
      // MathJax not ready yet
    });
  } catch {
    // ignore
  }
}

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
  };
  const handleMouseUp = () => {
    emit('resize-end');
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.editor-scroll::-webkit-scrollbar { width: 6px; }
.editor-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }
.editor-scroll::-webkit-scrollbar-track { background: var(--scrollbar-track); }
</style>
