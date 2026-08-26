<script setup lang="ts">
import { computed } from 'vue';
import type { SyncProvider } from '@/types';
import { Check, Cloud, Github, PlugZap } from 'lucide-vue-next';

const props = defineProps<{
  provider: SyncProvider;
  connected: boolean;
  credentialValue: string;
}>();

defineEmits<{
  toggle: [];
  test: [];
  configChanged: [config: Record<string, string>];
  credentialChanged: [value: string];
}>();

// 测试连接的前端拦截：没有凭据（既未保存到 Keychain，UI 输入也为空）时不允许点击。
// 同步状态机本身在 Phase 4 实现，此处只是 UI 收紧 + 防止静默触发远端 HTTP。
const credentialMissing = computed(() => !props.provider.hasCredential && !props.credentialValue.trim());
const requiredFieldsMissing = computed(() => {
  if (props.provider.type === 'github') {
    return !props.provider.config.api_url || !props.provider.config.owner || !props.provider.config.repo;
  }
  if (props.provider.type === 'webdav') {
    return !props.provider.config.url || !props.provider.config.username;
  }
  return true;
});
const testBlockedReason = computed(() => {
  if (credentialMissing.value) {
    return props.provider.type === 'github'
      ? '请先填写 GitHub Access Token 后再测试连接'
      : '请先填写 WebDAV 密码后再测试连接';
  }
  if (requiredFieldsMissing.value) {
    return '请先填写完必填配置项（URL / Owner / Repo 等）';
  }
  return '测试连接';
});
</script>

<template>
  <section class="sync-provider">
    <header class="sync-provider-header">
      <div class="sync-provider-title">
        <span class="provider-icon">
          <Github v-if="provider.type === 'github'" :size="19" />
          <Cloud v-else :size="19" />
        </span>
        <div>
          <strong>{{ provider.name }}</strong>
          <span v-if="connected" class="connection-state"><Check :size="12" /> 已连接</span>
        </div>
      </div>
      <label class="toggle-control">
        <input type="checkbox" :checked="provider.enabled" @change="$emit('toggle')" />
        <span aria-hidden="true"><i /></span>
      </label>
    </header>

    <div v-if="provider.enabled" class="sync-provider-form">
      <div v-if="provider.type === 'github'" class="input-grid">
        <InputField label="API URL" :value="provider.config.api_url" @input="$emit('configChanged', { ...provider.config, api_url: $event })" placeholder="https://api.github.com" />
        <InputField label="Owner" :value="provider.config.owner" @input="$emit('configChanged', { ...provider.config, owner: $event })" placeholder="组织或用户名" />
        <InputField label="Repository" :value="provider.config.repo" @input="$emit('configChanged', { ...provider.config, repo: $event })" placeholder="仓库名" />
        <InputField label="Branch" :value="provider.config.branch || 'main'" @input="$emit('configChanged', { ...provider.config, branch: $event })" placeholder="main" />
        <InputField label="Access Token" :value="credentialValue" @input="$emit('credentialChanged', $event)" type="password" :placeholder="provider.hasCredential ? '已保存，留空则继续使用' : '输入后保存到系统钥匙串'" />
      </div>
      <div v-if="provider.type === 'webdav'" class="input-grid">
        <InputField label="WebDAV URL" :value="provider.config.url" @input="$emit('configChanged', { ...provider.config, url: $event })" placeholder="https://cloud.example.com/remote.php/dav/" />
        <InputField label="Username" :value="provider.config.username" @input="$emit('configChanged', { ...provider.config, username: $event })" placeholder="用户名" />
        <InputField label="Password" :value="credentialValue" @input="$emit('credentialChanged', $event)" type="password" :placeholder="provider.hasCredential ? '已保存，留空则继续使用' : '输入后保存到系统钥匙串'" />
      </div>
      <button
        class="test-connection-button"
        :disabled="credentialMissing || requiredFieldsMissing"
        :title="testBlockedReason"
        @click="$emit('test')"
      >
        <PlugZap :size="15" />
        测试连接
      </button>
    </div>
  </section>
</template>
