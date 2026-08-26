import { resolve } from 'path';
import { defineConfig } from '@tauri-apps/cli';

export default defineConfig({
  beforeDevCommand: '',
  beforeBuildCommand: '',
  app: {
    windows: [
      {
        title: 'Markdown Beautiful',
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
      // Phase 0 / DEVELOPMENT_PLAN_SUPPLEMENT.md §6: 收紧 CSP, 关闭明显的数据与渲染风险。
      // - script-src 'self'           去掉 'unsafe-inline'; 全部 JS 由 Vite 打包为同源外部脚本,
      //                                PreviewPane 通过 document.createElement('script') + 同源
      //                                src 加载 mathjax/es5/tex-svg.js, 不依赖任何内联脚本。
      // - style-src 保留 'unsafe-inline' 是 MathJax SVG 输出的内联 style 属性所必需,
      //                                否则 SVG 公式节点会因 CSP 被丢弃。Vue SFC <style> 在
      //                                生产构建中被提取为外部 CSS, 不受此影响。
      // - connect-src 'self'           移除 https:/http: 宽通配; 本期无远端调用, 同步链路
      //                                走 Tauri IPC 不经过 WebView connect。
      // - img-src 'self' data: blob:   支持 Markdown 内联图片与预览缩略图。
      // - default-src 'self'           其它资源(字体/媒体/Worker)全部回退到同源。
      csp: "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';",
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
