<template>
  <div class="col-span-2">
    <label class="text-xs text-[var(--text-tertiary)] mb-0.5 block">{{ label }}</label>
    <input
      :type="type || 'text'"
      :value="value"
      @input="$emit('input', ($event.target as HTMLInputElement).value)"
      :placeholder="placeholder"
      class="w-full px-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
}>();
defineEmits<{ input: [value: string] }>();
</script>
