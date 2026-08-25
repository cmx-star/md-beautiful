# Mardown Beautiful

> 一款类 Bear / Notion / Obsidian 的跨平台 Markdown 笔记编辑器

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck
```

## 📐 技术架构

| 层级 | 技术选型 |
|------|----------|
| 跨平台框架 | **Electron** (macOS / Windows / Linux) |
| UI 框架 | **React 18** + TypeScript |
| 编辑器内核 | **Monaco Editor** (VS Code 同款) |
| 样式 | **Tailwind CSS** + CSS Variables (主题系统) |
| 状态管理 | **Zustand** (轻量级, 支持持久化) |
| Markdown 渲染 | **marked** + **remark** 插件链 (GFM / 代码高亮 / 安全净化) |
| 搜索 | **Fuse.js** (模糊搜索) |
| 本地存储 | JSON 文件 + IndexedDB (可扩展 SQLite) |

## 🏗️ 项目结构

```
mardown-beautiful/
├── electron/
│   ├── main.ts          # Electron 主进程 (窗口管理、文件系统 IPC)
│   └── preload.ts       # 安全桥接 (contextBridge)
├── src/
│   ├── components/
│   │   ├── Sidebar.tsx          # 笔记列表侧边栏 + 搜索
│   │   ├── EditorPane.tsx       # Monaco 编辑器面板
│   │   ├── PreviewPane.tsx      # Markdown 实时预览面板
│   │   ├── Toolbar.tsx          # 顶部工具栏
│   │   ├── CommandPalette.tsx   # ⌘K 命令面板
│   │   └── CommandsInitializer.tsx
│   ├── stores/
│   │   ├── noteStore.ts         # 笔记 CRUD + 搜索
│   │   ├── themeStore.ts        # 主题 + 用户偏好
│   │   ├── syncStore.ts         # 同步状态
│   │   ├── repositoryStore.ts   # GitLab/WebDAV 仓库管理
│   │   └── commandPaletteStore.ts
│   ├── sync/
│   │   ├── GitLabSyncEngine.ts      # GitLab API v4 同步
│   │   ├── WebDAVSynchronizeEngine.ts # WebDAV (Nextcloud/NAS)
│   │   └── SyncEngine.ts            # 统一接口抽象
│   ├── types/index.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron.vite.config.ts
└── tailwind.config.js
```

## ☁️ 同步方案

### GitLab 同步
- 使用 GitLab API v4 的 Repository Files API
- 每个笔记存储为 `.md` 文件，路径 `notes/{note-id}.md`
- 支持分支管理，可配置 default branch
- 自动创建/更新/删除文件，附带 commit message

### WebDAV 同步
- 兼容 Nextcloud、OwnCloud、Synology NAS 等
- 使用 PROPFIND 列出目录，PUT/DELETE 操作文件
- 支持 Basic Auth 认证

### 本地云盘同步 (iCloud / Dropbox)
- 监听指定本地文件夹
- 通过 Electron 原生文件系统 API 读写
- 依赖系统云盘同步代理

## 🗺️ 开发里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 — MVP | 基础编辑器 + 本地存储 + 双栏预览 | ✅ 已完成 |
| Phase 2 — 同步引擎 | GitLab + WebDAV 接入 | ✅ 已完成 |
| Phase 3 — 知识图谱 | 双向链接 + 关系图谱 | 🔲 待开发 |
| Phase 4 — 美化打磨 | 主题系统 + 动画 + 导出 PDF/HTML | 🔲 待开发 |
| Phase 5 — 发布 | 打包上架 (DMG / NSIS / AppImage) | 🔲 待开发 |

## 🔑 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘K` | 打开命令面板 |
| `⌘N` | 新建笔记 |
| `⌘S` | 同步笔记 |
| `⌘B` | 切换侧边栏 |
| `⌘T` | 切换主题 |
| `⌘,` | 打开设置 |
