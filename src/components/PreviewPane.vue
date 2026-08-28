<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { Marked } from 'marked';
import { sanitizeHtml } from '@/utils/sanitize';
import { resolveAssetPath } from '@/utils/assetPath';
import { attachmentService } from '@/services/attachmentService';
import { createDialectSession } from '@/utils/markdownDialect';
import {
  formulaCacheKey,
  mathConfigId,
  splitMathSegments,
  type MathDelimiter,
} from '@/utils/mathSegments';
import { useNoteIndex } from '@/composables/useNoteIndex';
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
  /** 阅读模式下预览独占整行宽度。 */
  fullWidth: boolean;
  /** 编辑器滚动比例（0-1），用于滚动同步。 */
  scrollRatio: number;
}>();
const emit = defineEmits<{
  'resize-start': [];
  'resize-end': [];
  'split-change': [ratio: number];
  'open-wiki-link': [target: string];
}>();

const store = useNoteStore();
const themeStore = useThemeStore();
const activeNote = computed(() => store.getActiveNote());
const noteIndex = useNoteIndex();

/** 反向链接（引用当前笔记的笔记），Phase 3。 */
const backlinks = computed(() => {
  const note = activeNote.value;
  if (!note || note.source?.kind !== 'vault') return [];
  const paths = noteIndex.value.backlinks.get(note.source.path) ?? [];
  return paths
    .map((path) => noteIndex.value.byPath.get(path))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
});

/** 当前笔记中未解析的双链目标，Phase 3。 */
const unresolvedLinks = computed(() => {
  const note = activeNote.value;
  if (!note || note.source?.kind !== 'vault') return [];
  return noteIndex.value.unresolved.get(note.source.path) ?? [];
});

function openBacklink(path: string) {
  const target = noteIndex.value.byPath.get(path);
  if (target) store.setActiveNote(target.id);
}
const previewRef = ref<HTMLElement | null>(null);
let renderVersion = 0;
let renderDebounce: ReturnType<typeof setTimeout> | null = null;

/** 用户 CSS（Phase 5）：作用于预览，导出走同一份配置。 */
watch(
  () => themeStore.userCss,
  (css) => {
    let el = document.getElementById('mdapp-user-css') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'mdapp-user-css';
      document.head.appendChild(el);
    }
    el.textContent = css.replace(/<\/style/gi, '<\\/style');
  },
  { immediate: true }
);

/** Phase 2 — 防抖渲染，避免每次击键全量重排。 */
const RENDER_DEBOUNCE_MS = 180;

watch(
  () => [activeNote.value?.id, activeNote.value?.content] as const,
  ([, content]) => {
    if (renderDebounce) clearTimeout(renderDebounce);
    renderDebounce = setTimeout(() => {
      void render(String(content ?? ''));
    }, RENDER_DEBOUNCE_MS);
  },
  { immediate: true }
);

async function render(nextContent: string) {
  const currentVersion = ++renderVersion;

  // ── Phase 5: segmented rendering with a per-formula SVG cache ──
  const segments = splitMathSegments(nextContent);
  const pending: Array<{ key: string; tex: string; display: MathDelimiter }> = [];
  const slotKeys: string[] = [];
  const parts: string[] = [];
  let slotIndex = 0;
  for (const segment of segments) {
    if (segment.type === 'text') {
      parts.push(segment.value);
      continue;
    }
    const display = segment.display ?? 'inline';
    const key = formulaCacheKey(segment.value, display, MATH_CONFIG_ID);
    if (!formulaCache.has(key)) pending.push({ key, tex: segment.value, display });
    parts.push(PLACEHOLDER(slotIndex));
    slotKeys[slotIndex] = key;
    slotIndex += 1;
  }
  if (pending.length > 0) await renderFormulasOffscreen(pending);

  const session = createDialectSession();
  const marked = new Marked({ gfm: true, breaks: true, extensions: session.extensions });
  const html = (marked.parse(parts.join('')) as string) ?? '';
  const safe = sanitizeHtml(html + session.takeFootnoteSection());

  await nextTick();
  if (!previewRef.value) return;

  getMathJax()?.typesetClear?.([previewRef.value]);

  let finalHtml = safe;
  for (let i = 0; i < slotKeys.length; i += 1) {
    const key = slotKeys[i];
    const cached = formulaCache.get(key);
    const fallback = cached === '' ? `<code class="math-error">${escapeHtml(segments.find((s) => s.type === 'math' && formulaCacheKey(s.value, s.display ?? 'inline', MATH_CONFIG_ID) === key)?.value ?? '')}</code>` : '';
    finalHtml = finalHtml.replaceAll(PLACEHOLDER(i), cached && cached !== '' ? cached : fallback);
  }

  previewRef.value.innerHTML = finalHtml;
  await nextTick();
  void resolvePreviewImages(previewRef.value, currentVersion);
}

// ── Formula render cache (Phase 5) ──────────────────────────────────────────

const MATH_CONFIG_ID = mathConfigId({
  inlineMath: [['$', '$'], ['\\(', '\\)']],
  displayMath: [['$$', '$$'], ['\\[', '\\]']],
});
const MAX_FORMULA_CACHE_ENTRIES = 500;
/** key → rendered SVG markup; '' means the formula failed to render. */
const formulaCache = new Map<string, string>();

const PLACEHOLDER = (index: number) => `%%MDAPP_MATH_${index}%%`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function offscreenContainer(): HTMLElement {
  let el = document.getElementById('mdapp-math-offscreen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mdapp-math-offscreen';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:absolute;left:-99999px;top:0;width:auto;height:auto;visibility:hidden;';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Render each uncached formula exactly once in a hidden container.
 * A failure marks the key as failed ('') so only that formula degrades —
 * the document body is never affected.
 */
async function renderFormulasOffscreen(
  entries: Array<{ key: string; tex: string; display: MathDelimiter }>
): Promise<void> {
  try {
    const mathJax = await ensureMathJax();
    if (formulaCache.size > MAX_FORMULA_CACHE_ENTRIES) formulaCache.clear();
    const container = offscreenContainer();
    container.innerHTML = '';
    entries.forEach((entry, index) => {
      const slot = document.createElement('span');
      slot.id = `mdapp-math-slot-${index}`;
      slot.textContent =
        entry.display === 'display' ? `$$${entry.tex}$$` : `\\(${entry.tex}\\)`;
      container.appendChild(slot);
    });
    await mathJax.typesetPromise?.([container]);
    entries.forEach((entry, index) => {
      const slot = container.querySelector(`#mdapp-math-slot-${index}`);
      formulaCache.set(entry.key, slot?.innerHTML ?? '');
    });
    mathJax.typesetClear?.([container]);
    container.innerHTML = '';
  } catch (error) {
    console.warn('MathJax render failed', error);
    for (const entry of entries) formulaCache.set(entry.key, '');
  }
}

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

/** 滚动同步：跟随编辑器比例滚动（0-1）。 */
watch(
  () => props.scrollRatio,
  (ratio) => {
    if (!themeStore.scrollSync) return;
    const container = previewRef.value?.closest('.preview-scroll') as HTMLElement | null;
    if (!container) return;
    const max = container.scrollHeight - container.clientHeight;
    if (max > 0) container.scrollTop = ratio * max;
  }
);

/** 双链点击：由 App.vue 解析目标笔记。 */
function handlePreviewClick(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest('.wiki-link');
  if (!target) return;
  event.preventDefault();
  const wikiTarget = target.getAttribute('data-wiki-target');
  if (wikiTarget) emit('open-wiki-link', wikiTarget);
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

<template>
  <section
    class="preview-pane"
    :style="{ width: props.fullWidth ? '100%' : `${100 - props.splitRatio}%` }"
  >
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
          @click="handlePreviewClick"
        />
        <section
          v-if="backlinks.length || unresolvedLinks.length"
          class="backlink-panel"
          data-testid="backlink-panel"
        >
          <template v-if="backlinks.length">
            <h3>反向链接（{{ backlinks.length }}）</h3>
            <button
              v-for="link in backlinks"
              :key="link.path"
              type="button"
              class="backlink-item"
              @click="openBacklink(link.path)"
            >
              {{ link.title || link.path }}
            </button>
          </template>
          <template v-if="unresolvedLinks.length">
            <h3>未解析链接（{{ unresolvedLinks.length }}）</h3>
            <span v-for="target in unresolvedLinks" :key="target" class="unresolved-chip">
              [[{{ target }}]]
            </span>
          </template>
        </section>
      </article>
    </div>
    <EmptyState v-else />
    <div class="pane-divider" aria-hidden="true" @mousedown="startResize" />
  </section>
</template>
