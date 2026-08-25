<template>
  <aside
    class="sidebar-shell flex-shrink-0 bg-[var(--surface-card)] border-r border-[var(--border-color)] flex flex-col transition-all duration-200"
    :style="{ width: open ? '260px' : '0px', minWidth: open ? '260px' : '0px', overflow: 'hidden' }"
  >
    <!-- Header -->
    <div class="sidebar-brand-shell flex-shrink-0">
      <div class="sidebar-brand-card" aria-label="Mardown Beautiful">
        <span class="font-semibold text-sm tracking-tight text-[var(--text-primary)]">Mardown</span>
        <span class="font-semibold text-sm tracking-tight text-[var(--accent)]">Beautiful</span>
      </div>
    </div>

    <!-- Search -->
    <div class="px-3 py-2 border-b border-[var(--border-color)] flex-shrink-0">
      <div class="relative">
        <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-xs">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索笔记…"
          class="w-full pl-7 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] rounded-md border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent)] transition-colors"
        />
      </div>
    </div>

    <!-- Folders -->
    <div v-if="folders.length > 0" class="px-2 py-1.5 border-b border-[var(--border-color)] flex-shrink-0">
      <div class="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider px-2 mb-1">文件夹</div>
      <div
        v-for="f in folders"
        :key="f.id"
        class="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--text-secondary)] rounded hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
      >
        <span>📁</span>
        <span class="truncate">{{ f.name }}</span>
        <span class="ml-auto text-[10px] text-[var(--text-tertiary)]">
          {{ notes.filter((n) => n.folderId === f.id).length }}
        </span>
      </div>
    </div>

    <!-- Notes -->
    <div class="sidebar-notes-list flex-1 overflow-y-auto scrollbar-thin">
      <div class="px-3 py-1.5 border-b border-[var(--border-color)] flex items-center justify-between flex-shrink-0">
        <span class="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">笔记 · {{ filteredNotes.length }}</span>
      </div>
      <div v-if="filteredNotes.length === 0" class="p-4 text-center text-[var(--text-tertiary)] text-xs">
        {{ searchQuery ? '没有匹配的笔记' : '还没有笔记' }}
      </div>
      <button
        v-for="note in filteredNotes"
        :key="note.id"
        @click="selectNote(note.id)"
        class="sidebar-note-item text-left px-3 py-2.5 rounded-md transition-all"
        :class="note.id === activeNoteId ? 'bg-[var(--surface-hover)] ring-1 ring-[var(--accent)]/30' : 'hover:bg-[var(--bg-secondary)]'"
      >
        <div class="flex items-start gap-2">
          <span class="text-base flex-shrink-0 mt-0.5">{{ getIcon(note) }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium text-[var(--text-primary)] truncate">{{ truncateTitle(note.title) }}</p>
            <p class="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">{{ stripMarkdown(note.content) || '空笔记' }}</p>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-[10px] text-[var(--text-tertiary)]">{{ relativeTime(note.updatedAt) }}</span>
              <div v-if="note.tags.length" class="flex gap-0.5">
                <span
                  v-for="tag in note.tags.slice(0, 2)"
                  :key="tag"
                  class="text-[10px] px-1 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] rounded"
                >#{{ tag }}</span>
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>

    <!-- Footer -->
    <div class="h-10 border-t border-[var(--border-color)] flex items-center px-3 gap-2 flex-shrink-0">
      <button
        @click="createNote"
        class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--accent)] text-white text-xs rounded-md hover:bg-[var(--accent-hover)] transition-colors"
      >
        <span>+</span>新建笔记
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNoteStore } from '@/stores/noteStore';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const store = useNoteStore();
const notes = computed(() => store.notes);
const folders = computed(() => store.folders);
const activeNoteId = computed(() => store.activeNoteId);
const searchQuery = computed({
  get: () => store.searchQuery,
  set: (v) => store.setSearchQuery(v),
});

const filteredNotes = computed(() => store.getFilteredNotes());

function selectNote(id: string) {
  store.setActiveNote(id);
}

function createNote() {
  store.addNote({
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

function getIcon(note: { isFavorite: boolean; content: string }) {
  if (note.isFavorite) return '⭐';
  if (note.content.includes('![')) return '🖼️';
  if (note.content.includes('```')) return '💻';
  return '📄';
}

function truncateTitle(title: string, max = 36): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

function stripMarkdown(content: string): string {
  return content.replace(/[#*`>\-\[\]!()~]/g, '').slice(0, 60);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
</script>
