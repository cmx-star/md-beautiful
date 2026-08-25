<template>
  <div class="border border-[var(--border-color)] rounded-lg p-4 mb-3">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span class="text-base">{{ provider.type === 'gitlab' ? '🦊' : '☁️' }}</span>
        <span class="text-sm font-medium text-[var(--text-primary)]">{{ provider.name }}</span>
        <span
          v-if="provider.enabled"
          class="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded"
        >已启用</span>
      </div>
      <label class="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" :checked="provider.enabled" @change="$emit('toggle')" class="sr-only peer" />
        <div class="w-9 h-5 bg-[var(--bg-tertiary)] rounded-full peer peer-checked:bg-[var(--accent)] transition-colors"></div>
        <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
      </label>
    </div>

    <div v-if="provider.enabled" class="space-y-2">
      <div v-if="provider.type === 'gitlab'" class="grid grid-cols-2 gap-2">
        <InputField label="API URL" :value="provider.config.api_url" @input="$emit('configChanged', { ...provider.config, api_url: $event })" placeholder="https://gitlab.com" />
        <InputField label="Project ID" :value="provider.config.project_id" @input="$emit('configChanged', { ...provider.config, project_id: $event })" placeholder="12345" />
        <InputField label="Access Token" :value="provider.config.token" @input="$emit('configChanged', { ...provider.config, token: $event })" type="password" placeholder="glpat-..." />
        <InputField label="Branch" :value="provider.config.branch || 'main'" @input="$emit('configChanged', { ...provider.config, branch: $event })" placeholder="main" />
      </div>
      <div v-if="provider.type === 'webdav'" class="grid grid-cols-2 gap-2">
        <InputField label="WebDAV URL" :value="provider.config.url" @input="$emit('configChanged', { ...provider.config, url: $event })" placeholder="https://cloud.example.com/remote.php/dav/" />
        <InputField label="Username" :value="provider.config.username" @input="$emit('configChanged', { ...provider.config, username: $event })" placeholder="用户名" />
        <InputField label="Password" :value="provider.config.password" @input="$emit('configChanged', { ...provider.config, password: $event })" type="password" placeholder="密码" class="col-span-2" />
      </div>
      <button
        class="w-full py-1.5 text-xs rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
        @click="$emit('test')"
      >
        测试连接
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SyncProvider } from '@/types';

defineProps<{
  provider: SyncProvider;
  connected: boolean;
}>();
const emit = defineEmits<{
  toggle: [];
  test: [];
  configChanged: [config: Record<string, string>];
}>();
</script>
