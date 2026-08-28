<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { marked } from 'marked';
import { sanitizeHtml } from '@/utils/sanitize';
import {
  EXPORT_FORMAT_LABELS,
  PANDOC_FORMATS,
  exportService,
  type ExportFormat,
  type ExportReport,
} from '@/services/exportService';
import { appLogger } from '@/services/logger';
import { X } from 'lucide-vue-next';

const emit = defineEmits<{ close: [] }>();

const noteStore = useNoteStore();
const themeStore = useThemeStore();
const activeNote = computed(() => noteStore.getActiveNote());

const format = ref<ExportFormat>('html');
const pandocVersion = ref<string | null>(null);
const report = ref<ExportReport | null>(null);
const exporting = ref(false);
const error = ref('');
const showCss = ref(false);

const FORMATS = Object.keys(EXPORT_FORMAT_LABELS) as ExportFormat[];

const formatDisabled = (fmt: ExportFormat) =>
  PANDOC_FORMATS.includes(fmt) && !pandocVersion.value;

const canExport = computed(() => {
  if (!activeNote.value || exporting.value) return false;
  return !formatDisabled(format.value);
});

onMounted(async () => {
  pandocVersion.value = await exportService.detectPandoc();
});

watch(showCss, (open) => {
  if (open && !themeStore.userCss) themeStore.userCss = '';
});

async function runExport() {
  const note = activeNote.value;
  if (!note) return;
  error.value = '';
  report.value = null;

  if (format.value === 'print') {
    window.print();
    void appLogger.info('ui.export.printed', note.title);
    return;
  }

  const targetPath = await exportService.pickTargetPath(note.title, format.value);
  if (!targetPath) {
    void appLogger.info('ui.export.cancelled');
    return;
  }

  exporting.value = true;
  try {
    marked.setOptions({ gfm: true, breaks: true });
    const bodyHtml = sanitizeHtml((marked.parse(note.content) as string) ?? '');
    const result = await exportService.exportCurrent({
      title: note.title,
      markdown: note.content,
      bodyHtml,
      format: format.value,
      userCss: themeStore.userCss,
      targetPath,
      notePath: note.source?.kind === 'vault' || note.source?.kind === 'file'
        ? note.source.path
        : note.id,
    });
    report.value = result;
    void appLogger.info(
      'ui.export.completed',
      `format=${result.format} engine=${result.engine} size=${result.size}`
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    void appLogger.error('ui.export.failed', err);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="command-overlay">
    <button class="overlay-backdrop" aria-label="关闭导出" @click="emit('close')" />
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-label="导出文档">
      <header class="settings-header">
        <h2 class="settings-title">导出当前文档</h2>
        <button class="icon-button" aria-label="关闭" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <div class="settings-body scrollbar-thin">
        <p v-if="!activeNote" class="settings-hint">请先选择要导出的笔记。</p>
        <template v-else>
          <div class="format-grid" role="radiogroup" aria-label="导出格式">
            <button
              v-for="fmt in FORMATS"
              :key="fmt"
              type="button"
              class="format-option"
              :class="{ 'is-active': format === fmt, 'is-disabled': formatDisabled(fmt) }"
              :disabled="formatDisabled(fmt)"
              :title="formatDisabled(fmt) ? '需要安装 pandoc CLI' : EXPORT_FORMAT_LABELS[fmt]"
              @click="format = fmt"
            >
              {{ EXPORT_FORMAT_LABELS[fmt] }}
            </button>
          </div>

          <p class="settings-hint">
            <template v-if="pandocVersion">检测到 {{ pandocVersion }} — Pandoc 格式可用。</template>
            <template v-else>
              未检测到 pandoc CLI：仅可导出 HTML / TXT / 打印。
              <a href="https://pandoc.org/installing.html" target="_blank" rel="noreferrer">安装 pandoc</a>
              后 DOCX / ODT / LaTeX / PDF / EPUB 等格式自动解锁。
            </template>
          </p>

          <div class="export-css">
            <button type="button" class="link-button" @click="showCss = !showCss">
              {{ showCss ? '隐藏' : '编辑' }}用户 CSS（预览与导出共用）
            </button>
            <textarea
              v-if="showCss"
              v-model="themeStore.userCss"
              class="css-editor"
              rows="6"
              aria-label="用户自定义 CSS"
              spellcheck="false"
            />
          </div>

          <p v-if="error" class="settings-error" data-testid="export-error">{{ error }}</p>
          <div v-if="report" class="export-report" data-testid="export-report">
            <p>✅ 已导出 {{ report.format }}（{{ report.engine }}，{{ report.size }} 字节）</p>
            <p><code>{{ report.target_path }}</code></p>
            <p v-for="warning in report.warnings" :key="warning" class="settings-hint">
              ⚠️ {{ warning }}
            </p>
          </div>

          <div class="export-actions">
            <button type="button" class="primary" :disabled="!canExport" @click="runExport">
              {{ exporting ? '导出中…' : '导出' }}
            </button>
          </div>
          <p class="settings-hint">
            导出通过临时文件原子写入；失败时不会覆盖已有目标文件，缺失附件会中止导出并报告。
          </p>
        </template>
      </div>
    </section>
  </div>
</template>
