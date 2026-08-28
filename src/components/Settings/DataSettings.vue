<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  listMigrationSnapshots,
  revertMigration,
  type MigrationLog,
} from '@/services/migrationService';
import { listRecoverableDrafts } from '@/services/draftService';
import { attachmentService, type AttachmentAudit } from '@/services/attachmentService';
import type { VaultAdapter } from '@/services/migrationService';

const props = defineProps<{
  vault: VaultAdapter | null;
  snapshotCount?: number;
}>();

const emit = defineEmits<{
  (e: 'revert', snapshotFile: string): void;
  (e: 'recover-draft', payload: { noteId: string }): void;
}>();

const snapshots = ref<Array<{ file: string; capturedAt: number }>>([]);
const drafts = ref<Array<{ noteId: string; ageMs: number; content: string }>>([]);
const log = ref<MigrationLog | null>(null);
const attachmentAudit = ref<AttachmentAudit | null>(null);
const auditError = ref('');

async function refresh() {
  if (!props.vault) {
    snapshots.value = [];
    log.value = null;
    return;
  }
  snapshots.value = await listMigrationSnapshots(props.vault);
  log.value = (await props.vault.readLog()) ?? null;
  drafts.value = listRecoverableDrafts().map((d) => ({
    noteId: d.noteId,
    ageMs: d.ageMs,
    content: d.entry.content,
  }));
  try {
    attachmentAudit.value = await attachmentService.audit();
    auditError.value = '';
  } catch (error) {
    attachmentAudit.value = null;
    auditError.value = String(error);
  }
}

function handleRevert(snapshotFile: string) {
  if (!props.vault) return;
  if (!window.confirm(`确定要把 ${snapshotFile} 回滚到 localStorage 吗？`)) return;
  emit('revert', snapshotFile);
}

function handleRecover(noteId: string) {
  if (!window.confirm(`确定要恢复草稿 ${noteId} 吗？`)) return;
  emit('recover-draft', { noteId });
}

onMounted(refresh);

defineExpose({ refresh });
</script>

<template>
  <section class="data-settings" data-testid="data-settings">
    <h2>笔记数据</h2>

    <article class="panel">
      <header>
        <h3>迁移快照</h3>
        <p class="hint">
          每次将 localStorage 笔记写入 Vault 时，会在 Vault 根目录保存一份
          JSON 快照，并把 imported/ 下的文件移到 <code>.reverted-&lt;iso&gt;/</code>。
        </p>
      </header>
      <p v-if="!props.vault" class="empty">需要先打开 Vault 才能管理快照。</p>
      <ul v-else-if="snapshots.length" data-testid="snapshot-list">
        <li v-for="s in snapshots" :key="s.file">
          <code>{{ s.file }}</code>
          <span>{{ new Date(s.capturedAt).toLocaleString() }}</span>
          <button
            type="button"
            class="danger"
            :aria-label="`回滚 ${s.file}`"
            @click="handleRevert(s.file)"
          >
            一键回滚
          </button>
        </li>
      </ul>
      <p v-else class="empty">暂无快照。</p>
    </article>

    <article class="panel">
      <header>
        <h3>未保存草稿</h3>
        <p class="hint">
          草稿键 <code>mardown-beautiful-drafts</code> 与笔记键和主题键相互隔离。
        </p>
      </header>
      <ul v-if="drafts.length" data-testid="draft-list">
        <li v-for="d in drafts" :key="d.noteId">
          <code>{{ d.noteId }}</code>
          <span>{{ Math.round(d.ageMs / 1000) }}s ago</span>
          <button
            type="button"
            :aria-label="`恢复草稿 ${d.noteId}`"
            @click="handleRecover(d.noteId)"
          >
            恢复
          </button>
        </li>
      </ul>
      <p v-else class="empty">没有可恢复的草稿。</p>
    </article>

    <article class="panel">
      <header>
        <h3>附件审计</h3>
        <p class="hint">
          扫描 <code>assets/</code> 目录中未被任何笔记引用的附件（孤儿附件）。
          按数据安全策略，应用 <strong>从不自动删除</strong> 孤儿附件，仅在此列出供人工处理。
        </p>
      </header>
      <p v-if="!props.vault" class="empty">需要先打开 Vault 才能审计附件。</p>
      <p v-else-if="auditError" class="empty">附件审计失败：{{ auditError }}</p>
      <template v-else-if="attachmentAudit">
        <p class="empty" data-testid="attachment-audit-summary">
          共 {{ attachmentAudit.total }} 个附件，其中孤儿附件 {{ attachmentAudit.orphans.length }} 个。
        </p>
        <ul v-if="attachmentAudit.orphans.length" data-testid="orphan-list">
          <li v-for="name in attachmentAudit.orphans" :key="name">
            <code>assets/{{ name }}</code>
          </li>
        </ul>
        <p v-else class="empty">没有孤儿附件。</p>
      </template>
    </article>

    <article v-if="log" class="panel">
      <header>
        <h3>迁移日志（最近 10 条）</h3>
      </header>
      <ol data-testid="migration-log">
        <li v-for="(entry, idx) in log.entries.slice(-10).reverse()" :key="idx">
          {{ new Date(entry.at).toLocaleString() }} — {{ entry.action }} —
          <code>{{ entry.snapshotFile ?? '—' }}</code> ({{ entry.importedCount }})
        </li>
      </ol>
    </article>
  </section>
</template>

<style scoped>
.data-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  color: var(--text);
}
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  background: var(--panel-bg);
}
.panel h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--hint, #666);
}
.empty {
  font-size: 12px;
  color: var(--hint, #888);
}
ul,
ol {
  margin: 0;
  padding-left: 16px;
  font-size: 13px;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
button {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: var(--button-bg, #f4f4f4);
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
}
button.danger {
  border-color: #c33;
  color: #c33;
}
</style>
