<script setup lang="ts">
import type { SyncProvider } from '@/types';
import { Check, Cloud, Github, PlugZap } from 'lucide-vue-next';

defineProps<{
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
      <button class="test-connection-button" @click="$emit('test')">
        <PlugZap :size="15" />
        测试连接
      </button>
    </div>
  </section>
</template>
