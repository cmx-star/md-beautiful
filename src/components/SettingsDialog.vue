<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useThemeStore } from '@/stores/themeStore';
import {
  formatCombo,
  normalizeCombo,
  type ShortcutDef,
} from '@/services/shortcutRegistry';
import type { HighlightConfig } from '@/utils/highlightStyle';

const emit = defineEmits<{ close: [] }>();

const themeStore = useThemeStore();
const tab = ref<'shortcuts' | 'appearance'>('shortcuts');
const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);

// ── 快捷键 ────────────────────────────────────────────────────────────────────

const shortcuts = computed<ShortcutDef[]>(() => themeStore.shortcuts());
const conflicts = computed(() => {
  const map = new Map<string, string[]>();
  const claim = new Map<string, string[]>();
  for (const def of shortcuts.value) {
    for (const combo of def.keys) {
      const ids = claim.get(combo) ?? [];
      ids.push(def.id);
      claim.set(combo, ids);
    }
  }
  for (const [combo, ids] of claim) {
    if (ids.length > 1) map.set(combo, ids);
  }
  return map;
});

const capturing = ref<string | null>(null);
const captureError = ref('');

function startCapture(id: string) {
  capturing.value = id;
  captureError.value = '';
}

function onCaptureKeydown(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    capturing.value = null;
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    // 清空该命令的键位（解绑）
    themeStore.setShortcutKeys(capturing.value!, []);
    capturing.value = null;
    return;
  }
  const combo = normalizeCombo(event);
  if (!combo) return;
  const error = themeStore.setShortcutKeys(capturing.value!, [combo]);
  if (error) {
    captureError.value = error;
    return;
  }
  captureError.value = '';
  capturing.value = null;
}

function resetOne(id: string) {
  themeStore.resetShortcut(id);
}

// ── 语法高亮 ─────────────────────────────────────────────────────────────────

const highlightSide = ref<'light' | 'dark'>('light');
const TOKEN_LABELS: Array<[keyof HighlightConfig, string]> = [
  ['heading', '标题'],
  ['strong', '加粗'],
  ['emphasis', '斜体'],
  ['link', '链接'],
  ['inlineCode', '行内代码'],
  ['quote', '引用'],
];

const highlightConfig = computed<HighlightConfig>(() =>
  highlightSide.value === 'dark'
    ? themeStore.highlightDark
    : themeStore.highlightLight
);

function setTokenColor(key: keyof HighlightConfig, value: string) {
  themeStore.setHighlight(highlightSide.value === 'dark', {
    ...highlightConfig.value,
    [key]: value,
  });
}

function resetHighlight() {
  themeStore.resetHighlight(highlightSide.value === 'dark');
}

onMounted(() => {
  // noop — kept for symmetry with future async loads
});
</script>

<template>
  <div class="command-overlay">
    <button class="overlay-backdrop" aria-label="关闭设置" @click="emit('close')" />
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
      <header class="settings-header">
        <nav class="settings-tabs">
          <button
            type="button"
            :class="{ 'is-active': tab === 'shortcuts' }"
            @click="tab = 'shortcuts'"
          >
            快捷键
          </button>
          <button
            type="button"
            :class="{ 'is-active': tab === 'appearance' }"
            @click="tab = 'appearance'"
          >
            语法高亮
          </button>
        </nav>
        <button type="button" class="settings-close" aria-label="关闭设置" @click="emit('close')">
          关闭
        </button>
      </header>

      <!-- 快捷键 -->
      <div v-if="tab === 'shortcuts'" class="settings-body scrollbar-thin">
        <p v-if="captureError" class="settings-error" data-testid="shortcut-conflict-error">
          {{ captureError }}
        </p>
        <table class="shortcut-table">
          <thead>
            <tr><th>命令</th><th>快捷键</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="def in shortcuts" :key="def.id">
              <td>
                {{ def.label }}
                <small class="scope-hint">{{ def.scope === 'app' ? '全局' : '编辑器' }}</small>
              </td>
              <td>
                <template v-if="capturing === def.id">
                  <input
                    class="shortcut-capture"
                    readonly
                    value="按下新快捷键…"
                    aria-label="录制新快捷键"
                    autofocus
                    @keydown="onCaptureKeydown"
                    @blur="capturing = null"
                  />
                </template>
                <template v-else>
                  <kbd
                    v-for="combo in def.keys"
                    :key="combo"
                    :class="{ 'has-conflict': conflicts.has(combo) }"
                  >
                    {{ formatCombo(combo, isMac) }}
                  </kbd>
                  <span v-if="def.keys.length === 0" class="unbound">未绑定</span>
                </template>
              </td>
              <td>
                <button type="button" class="link-button" @click="startCapture(def.id)">
                  修改
                </button>
                <button
                  v-if="themeStore.shortcutOverrides[def.id]"
                  type="button"
                  class="link-button"
                  @click="resetOne(def.id)"
                >
                  恢复默认
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="settings-hint">
          冲突的快捷键以红色显示；保存冲突键位会被阻止。录制时按 Esc 取消，退格键解绑。
        </p>
      </div>

      <!-- 语法高亮 -->
      <div v-else class="settings-body">
        <div class="highlight-side">
          <button
            type="button"
            :class="{ 'is-active': highlightSide === 'light' }"
            @click="highlightSide = 'light'"
          >
            浅色
          </button>
          <button
            type="button"
            :class="{ 'is-active': highlightSide === 'dark' }"
            @click="highlightSide = 'dark'"
          >
            深色
          </button>
          <button type="button" class="link-button" @click="resetHighlight">重置默认</button>
        </div>
        <div class="token-rows">
          <label v-for="[key, label] in TOKEN_LABELS" :key="key" class="token-row">
            <span>{{ label }}</span>
            <input
              type="color"
              :value="highlightConfig[key]"
              :aria-label="`${label}颜色`"
              @input="setTokenColor(key, ($event.target as HTMLInputElement).value)"
            />
            <code>{{ highlightConfig[key] }}</code>
          </label>
        </div>
        <p class="settings-hint">浅色与深色模式独立配置，立即生效并随应用持久化。</p>
      </div>
    </section>
  </div>
</template>
