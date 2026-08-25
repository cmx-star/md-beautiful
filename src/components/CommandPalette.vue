<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-24">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close" />
    <div
      class="relative w-full max-w-xl bg-[var(--surface-card)] border border-[var(--border-color)] rounded-xl shadow-2xl animate-zoom-in overflow-hidden"
    >
      <!-- Input -->
      <div class="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
        <span class="text-[var(--text-tertiary)]">🔍</span>
        <input
          v-model="query"
          ref="inputRef"
          type="text"
          placeholder="搜索命令…"
          class="flex-1 bg-transparent text-[var(--text-primary)] text-sm outline-none placeholder:text-[var(--text-tertiary)]"
          @keydown.down="selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1)"
          @keydown.up="selectedIndex = Math.max(selectedIndex - 1, 0)"
          @keydown.enter="execute(filtered[selectedIndex])"
          @keydown.esc="close"
        />
        <kbd class="text-xs text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">ESC</kbd>
      </div>

      <!-- Results -->
      <div class="max-h-80 overflow-y-auto scrollbar-thin">
        <div v-if="filtered.length === 0" class="p-4 text-center text-[var(--text-tertiary)] text-xs">
          无结果
        </div>
        <button
          v-for="(cmd, i) in filtered"
          :key="cmd.id"
          @click="execute(cmd)"
          class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          :class="i === selectedIndex ? 'bg-[var(--surface-hover)]' : 'hover:bg-[var(--bg-secondary)]'"
        >
          <span class="text-lg">{{ cmd.icon ?? '⚡' }}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-[var(--text-primary)]">{{ cmd.label }}</div>
            <div class="text-xs text-[var(--text-tertiary)] truncate">{{ cmd.description }}</div>
          </div>
          <span class="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{{ cmd.category }}</span>
          <kbd v-if="cmd.shortcut" class="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
            {{ cmd.shortcut }}
          </kbd>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

interface Command {
  id: string;
  label: string;
  description: string;
  icon?: string;
  shortcut?: string;
  category: 'file' | 'edit' | 'view' | 'sync' | 'settings' | 'help';
  action: () => void;
}

const emit = defineEmits<{ close: [] }>();

const query = ref('');
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const commands: Command[] = [
  { id: 'new-note', label: '新建笔记', description: '创建一条空白笔记', icon: '📝', shortcut: '⌘N', category: 'file', action: () => {} },
  { id: 'toggle-theme', label: '切换主题', description: '在浅色和深色主题之间切换', icon: '🎨', shortcut: '⌘T', category: 'view', action: () => {} },
  { id: 'sync', label: '同步笔记', description: '将本地笔记同步到云端', icon: '☁️', shortcut: '⌘S', category: 'sync', action: () => {} },
  { id: 'toggle-sidebar', label: '切换侧边栏', description: '显示或隐藏左侧笔记列表', icon: '📑', shortcut: '⌘B', category: 'view', action: () => {} },
  { id: 'settings', label: '设置', description: '打开应用设置面板', icon: '⚙️', shortcut: '⌘,', category: 'settings', action: () => {} },
  { id: 'export-pdf', label: '导出 PDF', description: '将当前笔记导出为 PDF 文件', icon: '📄', category: 'file', action: () => {} },
  { id: 'export-html', label: '导出 HTML', description: '将当前笔记导出为独立 HTML 文件', icon: '🌐', category: 'file', action: () => {} },
  { id: 'open-folder', label: '打开文件夹', description: '从文件系统导入 Markdown 文件', icon: '📂', shortcut: '⌘O', category: 'file', action: () => {} },
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

// Focus input on open
watch(
  () => true,
  () => {
    nextTick(() => inputRef.value?.focus());
  },
  { immediate: true }
);
</script>
