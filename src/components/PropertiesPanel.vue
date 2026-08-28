<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import {
  applyPropertyEdits,
  parseProperties,
  parseTagsValue,
  serializeTagsValue,
  type PropertyEdit,
} from '@/utils/properties';
import { appLogger } from '@/services/logger';

const store = useNoteStore();
const activeNote = computed(() => store.getActiveNote());
const showPanel = defineModel<boolean>('open', { default: false });

interface EditableField {
  key: string;
  value: string;
  isTags: boolean;
  tags: string[];
  original: string;
}

const fields = reactive<EditableField[]>([]);
const newKey = reactive({ value: '' });

function loadFromNote() {
  fields.length = 0;
  const note = activeNote.value;
  if (!note) return;
  const parsed = parseProperties(note.content);
  for (const field of parsed.fields) {
    const isTags = field.key === 'tags';
    fields.push({
      key: field.key,
      value: field.value,
      isTags,
      tags: isTags ? parseTagsValue(field.value) : [],
      original: field.value,
    });
  }
}

watch(
  () => [activeNote.value?.id, showPanel.value] as const,
  ([, open]) => {
    if (open) loadFromNote();
  },
  { immediate: true }
);

function commit() {
  const note = activeNote.value;
  if (!note) return;
  const edits: PropertyEdit[] = fields.map((field) => ({
    key: field.key,
    value: field.isTags ? serializeTagsValue(field.tags) : field.value,
  }));
  const next = applyPropertyEdits(note.content, edits);
  if (next !== note.content) {
    store.updateNote(note.id, { content: next });
    void appLogger.info('ui.properties.updated', `keys=${fields.length}`);
  }
}

function removeField(index: number) {
  fields.splice(index, 1);
  commit();
}

function addField() {
  const key = newKey.value.trim();
  if (!key || fields.some((f) => f.key === key)) return;
  fields.push({ key, value: '', isTags: false, tags: [], original: '' });
  newKey.value = '';
  commit();
}
</script>

<template>
  <div v-if="showPanel && activeNote" class="properties-panel" data-testid="properties-panel">
    <div class="properties-rows">
      <div v-for="(field, index) in fields" :key="field.key" class="property-row">
        <code class="property-key">{{ field.key }}</code>
        <template v-if="field.isTags">
          <input
            :value="field.tags.join(', ')"
            class="property-input"
            :aria-label="`标签列表（${field.key}）`"
            placeholder="逗号分隔的标签"
            @change="field.tags = ($event.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean); commit()"
          />
        </template>
        <input
          v-else
          v-model="field.value"
          class="property-input"
          :aria-label="`属性值（${field.key}）`"
          @change="commit"
        />
        <button
          type="button"
          class="property-remove"
          :aria-label="`删除属性 ${field.key}`"
          @click="removeField(index)"
        >
          ×
        </button>
      </div>
    </div>
    <div class="property-add">
      <input
        v-model="newKey.value"
        class="property-input"
        placeholder="新属性名，如 status"
        aria-label="新属性名"
        @keydown.enter.prevent="addField"
      />
      <button type="button" class="property-add-button" @click="addField">添加属性</button>
    </div>
    <p class="property-hint">
      未知字段会原样保留；修改仅写入 YAML 头部，不会重排正文。
    </p>
  </div>
</template>
