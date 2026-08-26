<script setup lang="ts">
import { Feather } from 'lucide-vue-next';
</script>

<template>
  <div class="empty-state">
    <div class="empty-state-mark">
      <Feather :size="25" />
      <i />
    </div>
    <strong>选择一条笔记</strong>
    <span>正文会在这里安静地展开</span>
  </div>
</template>
