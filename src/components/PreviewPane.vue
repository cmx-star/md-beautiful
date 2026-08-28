<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { marked } from 'marked';
import { sanitizeHtml } from '@/utils/sanitize';
import { resolveAssetPath } from '@/utils/assetPath';
import { attachmentService } from '@/services/attachmentService';
import EmptyState from '@/components/EmptyState.vue';
import mathJaxUrl from 'mathjax/es5/tex-svg.js?url';

interface MathJaxRuntime {
  startup?: {
    promise?: Promise<void>;
    typeset?: boolean;
  };
  tex?: Record<string, unknown>;
  svg?: Record<string, unknown>;
  options?: Record<string, unknown>;
  typesetPromise?: (elements: HTMLElement[]) => Promise<void>;
  typesetClear?: (elements: HTMLElement[]) => void;
}

function getMathJax(): MathJaxRuntime | undefined {
  return (window as typeof window & { MathJax?: MathJaxRuntime }).MathJax;
}

let mathJaxPromise: Promise<MathJaxRuntime> | null = null;

function ensureMathJax(): Promise<MathJaxRuntime> {
  const current = getMathJax();
  if (current?.typesetPromise) return Promise.resolve(current);
  if (mathJaxPromise) return mathJaxPromise;

  (window as typeof window & { MathJax?: MathJaxRuntime }).MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      processEscapes: true,
    },
    svg: {
      fontCache: 'local',
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    },
    startup: {
      typeset: false,
    },
  };

  mathJaxPromise = new Promise<MathJaxRuntime>((resolve, reject) => {
    document.getElementById('mathjax-runtime')?.remove();

    const script = document.createElement('script');
    script.id = 'mathjax-runtime';
    script.src = mathJaxUrl;
    script.async = true;
    script.addEventListener('load', async () => {
      try {
        const runtime = getMathJax();
        await runtime?.startup?.promise;
        if (!runtime?.typesetPromise) {
          throw new Error('MathJax browser runtime did not expose typesetPromise');
        }
        resolve(runtime);
      } catch (error) {
        reject(error);
      }
    });
    script.addEventListener('error', () => {
      reject(new Error('MathJax browser runtime failed to load'));
    });
    document.head.appendChild(script);
  }).catch((error) => {
    mathJaxPromise = null;
    throw error;
  });

  return mathJaxPromise;
}

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
const previewRef = ref<HTMLElement | null>(null);
let renderVersion = 0;

/**
 * Phase 1-C: rewrite Vault-relative `assets/…` image references into
 * `data:` URLs so the strict-CSP webview can render local attachments.
 * Failures leave the original alt text in place — they never break the doc.
 */
async function resolvePreviewImages(
  root: HTMLElement,
  versionAtStart: number
): Promise<void> {
  const note = activeNote.value;
  if (!note || note.source?.kind !== 'vault') return;
  const notePath = note.source.path;
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'));
  for (const img of images) {
    const src = img.getAttribute('src');
    if (!src) continue;
    const assetPath = resolveAssetPath(notePath, src);
    if (!assetPath || !assetPath.startsWith('assets/')) continue;
    try {
      const url = await attachmentService.readAsDataUrlCached(assetPath);
      if (renderVersion !== versionAtStart) return;
      img.src = url;
      img.loading = 'lazy';
    } catch (error) {
      console.warn(`附件加载失败: ${assetPath}`, error);
    }
  }
}

watch(
  () => [activeNote.value?.id, activeNote.value?.content] as const,
  async ([, content]) => {
    const currentVersion = ++renderVersion;
    const nextContent = content ?? '';

    marked.setOptions({ gfm: true, breaks: true });
    const html = (marked.parse(nextContent) as string) ?? '';
    const safe = sanitizeHtml(html);

    await nextTick();
    if (!previewRef.value) return;

    getMathJax()?.typesetClear?.([previewRef.value]);

    previewRef.value.innerHTML = safe;
    await nextTick();
    void resolvePreviewImages(previewRef.value, currentVersion);

    const containsMath = /(^|[^\\])\$\$?[\s\S]+?\$\$?|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/m.test(nextContent);
    if (!containsMath) return;

    try {
      const mathJax = await ensureMathJax();
      if (currentVersion !== renderVersion || !previewRef.value) return;
      await mathJax.typesetPromise?.([previewRef.value]);
    } catch (error) {
      console.warn('MathJax render failed', error);
    }
  },
  { immediate: true }
);

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

<template>
  <section class="preview-pane" :style="{ width: `${100 - props.splitRatio}%` }">
    <div class="pane-caption">
      <span>预览</span>
      <span v-if="activeNote">{{ activeNote.wordCount }} 字</span>
    </div>
    <div v-if="activeNote" class="preview-scroll scrollbar-thin">
      <article class="preview-document">
        <header class="preview-header">
          <h1>{{ activeNote.title || '无标题笔记' }}</h1>
          <div class="preview-meta">
            <span>{{ formatTime(activeNote.updatedAt) }}</span>
            <span v-if="activeNote.tags.length">{{ activeNote.tags.map((tag) => `#${tag}`).join(' · ') }}</span>
          </div>
        </header>
        <div
          ref="previewRef"
          class="markdown-preview"
          :class="themeStore.isDark ? 'dark' : ''"
        />
      </article>
    </div>
    <EmptyState v-else />
    <div class="pane-divider" aria-hidden="true" @mousedown="startResize" />
  </section>
</template>
