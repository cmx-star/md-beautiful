<script setup lang="ts">
import type { Component } from 'vue';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Sigma,
  SquareCode,
  Table,
} from 'lucide-vue-next';
import type { EditorView } from 'codemirror';
import {
  EDITOR_COMMANDS,
  heading1,
  heading2,
  heading3,
  insertCodeBlock,
  insertInlineMath,
  insertTable,
} from '@/services/editorCommands';

const props = defineProps<{ view: EditorView | null }>();

interface FormatAction {
  id: string;
  label: string;
  icon: Component;
}

const actions: FormatAction[] = [
  { id: 'h1', label: '标题 1', icon: Heading1 },
  { id: 'h2', label: '标题 2', icon: Heading2 },
  { id: 'h3', label: '标题 3', icon: Heading3 },
  { id: 'fmt-bold', label: '加粗', icon: Bold },
  { id: 'fmt-italic', label: '斜体', icon: Italic },
  { id: 'fmt-code', label: '行内代码', icon: Code },
  { id: 'fmt-link', label: '链接', icon: Link2 },
  { id: 'fmt-bullet', label: '无序列表', icon: List },
  { id: 'fmt-ordered', label: '有序列表', icon: ListOrdered },
  { id: 'fmt-task', label: '任务列表', icon: ListTodo },
  { id: 'fmt-quote', label: '引用', icon: Quote },
  { id: 'table', label: '表格', icon: Table },
  { id: 'code-block', label: '代码块', icon: SquareCode },
  { id: 'math', label: '行内公式', icon: Sigma },
];

function run(action: FormatAction) {
  const view = props.view;
  if (!view) return;
  const registry = EDITOR_COMMANDS[action.id];
  if (registry) {
    registry(view);
  } else if (action.id === 'h1') {
    heading1(view);
  } else if (action.id === 'h2') {
    heading2(view);
  } else if (action.id === 'h3') {
    heading3(view);
  } else if (action.id === 'table') {
    insertTable(view);
  } else if (action.id === 'code-block') {
    insertCodeBlock(view);
  } else if (action.id === 'math') {
    insertInlineMath(view);
  }
  view.focus();
}
</script>

<template>
  <div class="format-bar" role="toolbar" aria-label="Markdown 格式化">
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="format-button"
      :aria-label="action.label"
      :title="action.label"
      @mousedown.prevent
      @click="run(action)"
    >
      <component :is="action.icon" :size="15" />
    </button>
  </div>
</template>
