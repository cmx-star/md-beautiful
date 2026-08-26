<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
}>();

defineEmits<{ input: [value: string] }>();
</script>

<template>
  <label class="input-field">
    <span>{{ label }}</span>
    <input
      :type="type || 'text'"
      :value="value"
      @input="$emit('input', ($event.target as HTMLInputElement).value)"
      :placeholder="placeholder"
    />
  </label>
</template>
