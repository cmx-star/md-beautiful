import { resolve } from 'path';
import { defineConfig } from '@tauri-apps/cli';

export default defineConfig({
  beforeDevCommand: '',
  beforeBuildCommand: '',
  app: {
    windows: [
      {
        title: 'Mardown Beautiful',
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        resizable: true,
        fullscreen: false,
        dragDropEnabled: false,
        transparent: false,
        titleBarStyle: 'Overlay',
      },
    ],
    security: {
      csp: "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' https: http:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';",
    },
  },
  bundler: {
    bundles: ['src/**/*.vue', 'src/**/*.ts'],
    withGlobalTauri: true,
  },
  bundle: {
    active: true,
    targets: 'all',
    icon: [],
  },
});
