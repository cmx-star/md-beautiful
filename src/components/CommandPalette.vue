<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, type Component } from 'vue';
import {
  BookOpen,
  Cloud,
  Columns2,
  Database,
  FileInput,
  FilePlus2,
  FolderOpen,
  Moon,
  PanelLeft,
  PencilLine,
  Search,
  Settings,
  Sun,
} from 'lucide-vue-next';
import type { ViewMode } from '@/types';

interface Command {
  id: string;
  label: string;
  description: string;
  icon: Component;
  shortcut?: string;
  category: '文件' | '视图' | '同步' | '数据';
  action: () => void;
}

const emit = defineEmits<{
  close: [];
  'open-file': [];
  'open-vault': [];
  'new-note': [];
  'toggle-theme': [];
  'toggle-sidebar': [];
  sync: [];
  'open-data-settings': [];
  'open-settings': [];
  'set-view-mode': [mode: ViewMode];
}>();

const query = shallowRef('');
const selectedIndex = shallowRef(0);
const inputRef = shallowRef<HTMLInputElement | null>(null);

const commands: Command[] = [
  { id: 'new-note', label: '新建笔记', description: '创建一条空白笔记', icon: FilePlus2, shortcut: '⌘N', category: '文件', action: () => emit('new-note') },
  { id: 'open-file', label: '打开 Markdown 文件', description: '打开并编辑单个本地 Markdown 文件', icon: FileInput, shortcut: '⌘O', category: '文件', action: () => emit('open-file') },
  { id: 'open-folder', label: '打开 Vault', description: '载入本地 Markdown 目录', icon: FolderOpen, shortcut: '⌘⇧O', category: '文件', action: () => emit('open-vault') },
  { id: 'view-editor', label: '源码模式', description: '只显示编辑器', icon: PencilLine, shortcut: '⌘1', category: '视图', action: () => emit('set-view-mode', 'editor') },
  { id: 'view-split', label: '实时预览', description: '编辑器与预览分栏显示', icon: Columns2, shortcut: '⌘2', category: '视图', action: () => emit('set-view-mode', 'split') },
  { id: 'view-preview', label: '阅读模式', description: '只显示阅读视图', icon: BookOpen, shortcut: '⌘3', category: '视图', action: () => emit('set-view-mode', 'preview') },
  { id: 'toggle-theme', label: '切换主题', description: '在浅色和深色外观之间切换', icon: Moon, category: '视图', action: () => emit('toggle-theme') },
  { id: 'toggle-sidebar', label: '切换侧边栏', description: '显示或隐藏导航与笔记列表', icon: PanelLeft, shortcut: '⌘\\', category: '视图', action: () => emit('toggle-sidebar') },
  { id: 'settings', label: '设置', description: '自定义快捷键与语法高亮', icon: Settings, category: '视图', action: () => emit('open-settings') },
  { id: 'sync', label: '同步笔记', description: '打开同步设置并执行同步', icon: Cloud, category: '同步', action: () => emit('sync') },
  { id: 'data-settings', label: '笔记数据', description: '管理迁移快照、草稿与迁移日志', icon: Database, category: '数据', action: () => emit('open-data-settings') },
];

const filtered = computed(() => {
  if (!query.value.trim()) return commands;
  const q = query.value.toLowerCase();
  return commands.filter(
    (c: Command) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
  );
});

function execute(cmd: Command | undefined) {
  if (cmd) cmd.action();
  close();
}

function close() {
  query.value = '';
  selectedIndex.value = 0;
  emit('close');
}

onMounted(() => {
  nextTick(() => inputRef.value?.focus());
});
</script>

<template>
  <div class="command-overlay">
    <button class="overlay-backdrop" aria-label="关闭命令面板" @click="close" />
    <section class="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <header class="command-search">
        <Search :size="18" />
        <input
          ref="inputRef"
          v-model="query"
          type="search"
          placeholder="搜索命令"
          @keydown.down.prevent="selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1)"
          @keydown.up.prevent="selectedIndex = Math.max(selectedIndex - 1, 0)"
          @keydown.enter="execute(filtered[selectedIndex])"
          @keydown.esc="close"
        />
        <kbd>ESC</kbd>
      </header>

      <div class="command-results scrollbar-thin">
        <div v-if="filtered.length === 0" class="command-empty">没有匹配的命令</div>
        <button
          v-for="(command, index) in filtered"
          :key="command.id"
          class="command-item"
          :class="{ 'is-selected': index === selectedIndex }"
          @click="execute(command)"
        >
          <span class="command-icon">
            <component :is="command.icon" :size="18" />
          </span>
          <span class="command-copy">
            <strong>{{ command.label }}</strong>
            <small>{{ command.description }}</small>
          </span>
          <span class="command-category">{{ command.category }}</span>
          <kbd v-if="command.shortcut">{{ command.shortcut }}</kbd>
        </button>
      </div>
    </section>
  </div>
</template>
