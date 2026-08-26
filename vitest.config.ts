import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // jsdom is used over happy-dom because happy-dom's HTMLIFrameElement
    // synchronously triggers a navigation on attach, and its
    // WindowErrorUtility throws an internal TypeError when the navigation
    // fails, surfacing as a vitest "unhandled error" in the test runner
    // even though the sanitizer strips the iframe correctly.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
