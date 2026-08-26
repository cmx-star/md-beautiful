# Markdown Beautiful

> 一款类 Bear / Notion / Obsidian 的跨平台 Markdown 笔记编辑器

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 开发模式（Tauri + Vite 热重载）
npm run tauri:dev

# 构建（类型检查 + Vite 构建）
npm run build

# 类型检查
npm run typecheck

# Rust 检查
cargo check
cargo fmt
```

### 测试

```bash
npm run test          # vitest 单元测试
npm run typecheck     # 前端类型检查
cd src-tauri && cargo test   # Rust 单元测试
```

## 📐 技术架构

| 层级 | 技术选型 |
|------|----------|
| 跨平台框架 | **Tauri 2** (Rust 后端, macOS / Windows / Linux) |
| UI 框架 | **Vue 3.5** + Composition API + TypeScript |
| 编辑器内核 | **CodeMirror 6** (Markdown 模式, via vue-codemirror) |
| 样式 | **Tailwind CSS 3.4** + CSS Variables (主题系统) |
| 状态管理 | **Pinia 3** + pinia-plugin-persistedstate |
| Markdown 渲染 | **marked** (GFM) + HTML 白名单清洗 |
| 公式 | **MathJax 3** (本地打包 + Web Worker 计划) |
| 本地文件 | Tauri fs commands (Vault 边界 + 原子写入) |
| 同步 | GitLab API v4 + WebDAV (Rust reqwest, 统一状态机开发中) |

## 🏗️ 项目结构

```
mardown-beautiful/
├── src/                          # Vue 3 前端
│   ├── components/
│   │   ├── Sidebar.vue           # 笔记列表侧边栏 + 搜索
│   │   ├── EditorPane.vue        # CodeMirror 编辑器面板
│   │   ├── PreviewPane.vue       # Markdown 实时预览面板
│   │   ├── Toolbar.vue           # 顶部工具栏
│   │   ├── CommandPalette.vue    # ⌘K 命令面板
│   │   ├── SyncPanel.vue         # 同步设置面板
│   │   ├── SyncCard.vue          # 同步服务卡片
│   │   ├── InputField.vue        # 通用输入框
│   │   └── EmptyState.vue        # 空状态占位
│   ├── stores/
│   │   ├── noteStore.ts          # 笔记 CRUD + 搜索
│   │   ├── themeStore.ts         # 主题 + 用户偏好
│   │   └── syncStore.ts          # 同步状态
│   ├── types/index.ts
│   ├── App.vue
│   ├── main.ts
│   └── style.css
├── src-tauri/                    # Tauri 2 Rust 后端
│   └── src/main.rs               # 文件 I/O、GitLab/WebDAV 同步命令
├── DEVELOPMENT_PLAN_SUPPLEMENT.md  # 详细开发路线图
└── tauri.conf.json
```

> ⚠️ 当前 UI 中的"开始同步"按钮在未配置凭据或 isSyncing 时处于禁用状态，且即便在未禁用时也只记录"未实现"日志，不会触发任何远端 HTTP 请求。

## ☁️ 同步方案（开发中）

> ⚠️ 当前状态：底层 HTTP 接口已就绪（Rust reqwest），但**同步状态机尚未实现**。
> UI 中的「开始同步」按钮在未配置凭据时提示"未配置同步服务"，不会执行任何远端操作。

### GitLab 同步（规划中）
- 使用 GitLab API v4 的 Repository Files API
- 每个笔记存储为 `.md` 文件，路径 `notes/{note-id}.md`
- 支持分支管理，可配置 default branch
- 计划：基线对比 + 条件写入，禁止自动强推

### WebDAV 同步（规划中）
- 兼容 Nextcloud、OwnCloud、Synology NAS 等
- 使用 PROPFIND 列出目录，PUT/DELETE 操作文件
- 计划：ETag / If-Match 条件写入，冲突时保留副本而非覆盖

### 本地云盘同步 (iCloud / Dropbox)
- 用户选择系统云盘同步目录作为 Vault
- 依赖系统云盘同步代理完成远端同步

## 🗺️ 开发里程碑

详细路线图见 [DEVELOPMENT_PLAN_SUPPLEMENT.md](./DEVELOPMENT_PLAN_SUPPLEMENT.md)

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 — 基线校准与安全止血 | 文档修正 + HTML 清洗 + CSP 收紧 + 构建基线 | ✅ 已完成（基线校准与安全止血） |
| Phase 1 — 本地优先与数据安全 | Vault 打开/读取/编辑/保存/监听/恢复闭环 | 🔲 待开发 |
| Phase 2 — 写作体验与 Markdown 兼容 | 编辑命令 + 渐进隐藏 + 三种视图模式 | 🔲 待开发 |
| Phase 3 — 知识管理与索引 | 双向链接 + 标签 + 全文搜索 | 🔲 待开发 |
| Phase 4 — 可靠同步与冲突中心 | GitLab/WebDAV 状态机 + 冲突处理 | 🔲 待开发 |
| Phase 5 — 公式性能与受限扩展 | 本地 MathJax + Worker 压测 | 🔲 待开发 |
| Phase 6 — 发布与质量验收 | 三平台打包 + 签名 + 自动更新 | 🔲 待开发 |

> Phase 0 验收包含：文档准确、构建基线、HTML 清洗回归、MathJax 本地化、CSP 收紧、Vault 路径边界单元测试、同步 UI 禁用。

> 📌 **当前定位**：可交互桌面原型。笔记数据仍存储于浏览器 localStorage，
> 「本地 `.md` 文件是唯一事实来源」的目标将在 Phase 1 实现。

## 🔑 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘K` | 打开命令面板 |
| `⌘N` | 新建笔记 |
| `⌘B` | 切换侧边栏 |
| `⌘T` | 切换主题 |
| `⌘,` | 打开同步设置 |
