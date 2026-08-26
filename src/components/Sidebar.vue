<script setup lang="ts">
import { computed, type Component } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { vaultService } from '@/services/vaultService';
import {
  Archive,
  BookOpenText,
  CalendarDays,
  ChevronRight,
  Code2,
  FileText,
  Folder,
  Hash,
  Image,
  Inbox,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  SquareCheckBig,
  SquarePen,
  Star,
  Tags,
  Vault,
} from 'lucide-vue-next';

defineProps<{ open: boolean }>();
const emit = defineEmits<{
  toggle: [];
  'open-vault': [];
}>();

const store = useNoteStore();
const notes = computed(() => store.notes);
const folders = computed(() => store.folders);
const activeNoteId = computed(() => store.activeNoteId);
const searchQuery = computed({
  get: () => store.searchQuery,
  set: (v) => store.setSearchQuery(v),
});

const filteredNotes = computed(() => store.getFilteredNotes());
const vaultName = computed(() => {
  if (!store.vaultRoot) return '打开 Vault';
  return store.vaultRoot.split('/').filter(Boolean).at(-1) ?? store.vaultRoot;
});

function selectNote(id: string) {
  store.setActiveNote(id);
}

async function createNote() {
  if (!store.vaultRoot) {
    emit('open-vault');
    return;
  }
  const id = crypto.randomUUID();
  const relPath = `notes/${id}.md`;
  try {
    await vaultService.createNote(relPath, '');
    store.addNote({
      id,
      title: '无标题笔记',
      content: '',
      source: { kind: 'vault', path: relPath },
      folderId: null,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wordCount: 0,
      isFavorite: false,
    });
    store.setActiveNote(id);
  } catch (e) {
    console.error('Create note failed:', e);
  }
}

function getNoteIcon(note: { isFavorite: boolean; content: string }): Component {
  if (note.isFavorite) return Star;
  if (note.content.includes('![')) return Image;
  if (note.content.includes('```')) return Code2;
  return FileText;
}

function folderNoteCount(folderId: string): number {
  return notes.value.filter((note) => note.folderId === folderId).length;
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

<template>
  <aside class="sidebar-shell" :class="{ 'is-open': open }">
    <nav class="sidebar-navigation" aria-label="笔记导航">
      <div class="sidebar-brand" aria-label="Markdown Beautiful" data-tauri-drag-region>
        <span class="brand-mark"><i /></span>
        <span class="brand-name">Markdown</span>
      </div>

      <div class="nav-groups scrollbar-thin">
        <div class="nav-group">
          <button class="nav-item is-active">
            <BookOpenText :size="17" />
            <span>笔记</span>
            <strong>{{ notes.length }}</strong>
          </button>
          <button class="nav-item">
            <Inbox :size="17" />
            <span>未归档</span>
          </button>
          <button class="nav-item">
            <SquareCheckBig :size="17" />
            <span>待办</span>
          </button>
          <button class="nav-item">
            <CalendarDays :size="17" />
            <span>今天</span>
          </button>
          <button class="nav-item">
            <Archive :size="17" />
            <span>归档</span>
          </button>
        </div>

        <div class="nav-section-label">
          <span>标签</span>
          <Plus :size="14" />
        </div>
        <div class="nav-group">
          <button class="nav-item">
            <Tags :size="17" />
            <span>全部标签</span>
          </button>
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="nav-item"
          >
            <ChevronRight :size="14" />
            <Folder :size="16" />
            <span>{{ folder.name }}</span>
            <strong>{{ folderNoteCount(folder.id) }}</strong>
          </button>
          <button v-if="folders.length === 0" class="nav-item is-muted">
            <Hash :size="17" />
            <span>Markdown</span>
          </button>
        </div>
      </div>

      <div class="navigation-footer">
        <button class="nav-icon-button" aria-label="设置" title="设置">
          <Settings2 :size="17" />
        </button>
        <button class="nav-icon-button" aria-label="收起侧边栏" title="收起侧边栏" @click="emit('toggle')">
          <PanelLeftClose :size="17" />
        </button>
      </div>
    </nav>

    <section class="notes-column">
      <header class="notes-header">
        <div>
          <span class="notes-eyebrow">全部笔记</span>
          <h1>Notes</h1>
        </div>
        <div class="notes-header-actions">
          <button class="icon-button" aria-label="搜索笔记" title="搜索笔记">
            <Search :size="18" />
          </button>
          <button class="icon-button" aria-label="新建笔记" title="新建笔记" @click="createNote">
            <SquarePen :size="18" />
          </button>
        </div>
      </header>

      <label class="notes-search">
        <Search :size="15" />
        <input v-model="searchQuery" type="search" placeholder="搜索笔记" />
      </label>

      <button class="vault-row" @click="emit('open-vault')">
        <Vault :size="15" />
        <span>{{ vaultName }}</span>
        <ChevronRight :size="14" />
      </button>

      <div class="notes-list scrollbar-thin">
        <div v-if="filteredNotes.length === 0" class="notes-empty">
          <FileText :size="22" />
          <strong>{{ searchQuery ? '没有匹配结果' : '这里还没有笔记' }}</strong>
          <span>{{ store.vaultRoot ? '新建一条笔记开始写作' : '打开一个 Vault 载入 Markdown' }}</span>
        </div>

        <button
          v-for="note in filteredNotes"
          :key="note.id"
          class="note-list-item"
          :class="{ 'is-active': note.id === activeNoteId }"
          @click="selectNote(note.id)"
        >
          <component :is="getNoteIcon(note)" :size="16" class="note-kind-icon" />
          <div class="note-list-copy">
            <strong>{{ note.title || '无标题笔记' }}</strong>
            <p>{{ stripMarkdown(note.content) || '空笔记' }}</p>
            <footer>
              <span>{{ relativeTime(note.updatedAt) }}</span>
              <span v-if="note.tags.length">{{ note.tags.slice(0, 2).map((tag) => `#${tag}`).join(' ') }}</span>
            </footer>
          </div>
        </button>
      </div>

      <footer class="notes-footer">
        <button class="new-note-button" @click="createNote">
          <Plus :size="16" />
          <span>新建笔记</span>
        </button>
      </footer>
    </section>
  </aside>
</template>
