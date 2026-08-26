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
npm run test          # vitest 单元测试（含 slugify / frontmatter / migrationService / draftService / data-settings smoke）
npm run typecheck     # 前端类型检查
cd src-tauri && cargo test   # Rust 单元测试（含 migration_helpers）
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
│   │   ├── EmptyState.vue        # 空状态占位
│   │   └── Settings/
│   │       └── DataSettings.vue  # 笔记数据：迁移快照 + 草稿 + 迁移日志
│   ├── services/
│   │   ├── migrationService.ts   # Pinia → Vault 一次性迁出 + 快照回滚
│   │   ├── draftService.ts       # 草稿键隔离 (mardown-beautiful-drafts)
│   │   └── vaultAdapter.ts       # vaultService ↔ migrationService 桥接
│   ├── utils/
│   │   ├── slugify.ts            # 笔记标题 → 文件名（≤60 字符 + Windows 保留名保护）
│   │   └── frontmatter.ts        # Frontmatter 序列化/反序列化
│   ├── stores/
│   │   ├── noteStore.ts          # 笔记 CRUD + 搜索（仅 UI 偏好持久化）
│   │   ├── themeStore.ts         # 主题 + 用户偏好
│   │   └── syncStore.ts          # 同步状态
│   ├── types/index.ts
│   ├── App.vue
│   ├── main.ts
│   └── style.css
├── src-tauri/                    # Tauri 2 Rust 后端
│   ├── src/
│   │   ├── main.rs               # 文件 I/O、GitLab/WebDAV 同步命令
│   │   └── migration_helpers.rs  # Phase 1-A：slug / frontmatter / snapshot / rollback helpers
│   └── Cargo.toml
├── DEVELOPMENT_PLAN_SUPPLEMENT.md  # 详细开发路线图
└── tauri.conf.json
```

> ⚠️ 当前 UI 中的"开始同步"按钮在未配置凭据或 isSyncing 时处于禁用状态，且即便在未禁用时也只记录"未实现"日志，不会触发任何远端 HTTP 请求。

## 🗂️ 笔记存储位置

Phase 1-A 起，应用只把 **UI 偏好** 持久化到 localStorage，所有笔记正文以 **`.md` 文件** 形式存在于用户选择的 Vault 目录下。localStorage 键互不干扰：

| 键名 | 用途 | 是否迁移源 |
|------|------|------|
| `mardown-beautiful-note-store` | Vault 路径、`activeNoteId`、侧边栏状态、搜索词（**不含笔记正文**） | 否 |
| `mardown-beautiful-drafts` | 未保存编辑的草稿（与笔记正文隔离） | 否 |
| `mardown-beautiful-theme` | 主题模式 | 否 |
| `mardown-beautiful-notes` | **遗留 Pinia 笔记正文**（Phase 1-A 一次性迁出后清空） | 是 |

Vault 目录迁出后的结构：

```
<Vault 根目录>/
├── .migration-backup-2026-08-26T01-02-03-004Z.json   # 迁出前的 JSON 快照
├── .migration-log.json                                 # 追加式审计日志
└── imported/
    ├── Hello world.md                                  # 含 YAML Frontmatter
    ├── ...
    └── .reverted-2026-08-26T05-00-00-000Z/             # 一次回滚产物
        ├── Hello world.md
        └── ...
```

> 命令面板（⌘K）→「笔记数据」可看到所有快照、当前可恢复草稿与最近 10 条迁移日志；点击「一键回滚」会把 `imported/` 整体搬到 `.reverted-<iso>/` 并把快照里的笔记写回 `mardown-beautiful-notes`。

## 📝 草稿恢复

草稿与笔记正文使用 **完全独立的 localStorage 键**（`mardown-beautiful-drafts`），不与笔记/主题/UI 偏好混用。每次编辑会自动保存草稿条目（包含 `content` / `baseMtime` / `baseSize` / `savedAt`），下次打开 Vault 时如果发现草稿与文件不同，会弹出三选项 `alertdialog`：

- **恢复（覆盖 Vault 内对应文件）** — 把草稿内容写回 Vault
- **仅查看** — 不修改 Vault，仅显示草稿内容
- **放弃** — 清空这条草稿

按钮均带 `aria-label`，键盘 / 屏幕阅读器友好。草稿键是读写时机的"防误丢"缓冲，不是数据库；它是 Phase 1-B 之前的最轻量保底。

## 👀 外部修改检测（Phase 1-B）

打开 Vault 时，Rust 端会用 [`notify`](https://crates.io/crates/notify) 启动一个递归监听，监听范围限定在 Vault 根目录。后端先把以下路径直接丢弃，避免给前端制造噪音：

- `.migration-backup-*.json`、`imported/.reverted-*` — Pinia 笔记迁出过程中产生的快照与回滚目录
- `.migration-log.json` — 迁移日志

应用自身通过 `vault_write_file` / `vault_create_note` / `vault_rename_file` / `vault_delete_file` 写入的路径会进入 `pending_self_writes`，watcher 收到同 path 的 OS 事件时会吞掉不向前端推送。`close_vault`（或应用退出时）会 drop 句柄、清空 `fingerprints` / `sync_baseline`，不会有 leaked thread。

前端通过 `vaultService.onChange(callback)` 订阅 `vault://changed` 事件，App.vue 的 handler 三种分支：

- `created` / `removed` —— 静默刷新侧边栏 `noteStore.vaultFiles`，不打断用户
- `modified` 且非当前 active note —— 静默刷新
- `modified` 且**是**当前 active note —— 弹 `alertdialog` 提示，**绝不**静默覆盖；提供「重新载入」（走 `vault_read_file` 覆盖编辑器）和「保留我的编辑」（仅清提示）二选一按钮

新增/修改/删除事件 payload 形如 `{ path: string, kind: 'created' | 'modified' | 'removed', at: number }`（`path` 是相对 Vault 根的 forward-slash 路径，`at` 是毫秒时间戳）。

## ☁️ 同步方案（开发中）

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
| Phase 1-A — Pinia 迁出 + 草稿恢复 + 快照回滚 | 一次性迁出到 Vault + 草稿键隔离 + 迁移日志 + 一键回滚 UI | ✅ 已完成（数据迁出与回滚） |
| Phase 1-B — Vault 监听 + 外部修改检测 | `notify` 递归监听 + `vault://changed` 事件 + 自写去噪 + 迁移产物过滤 + active-note 弹 toast + `close_vault` | ✅ 已完成（外部修改检测） |
| Phase 1-C — 附件导入 | 拖拽 / 粘贴 / 复制进 Vault 子目录 | 🔲 待开发 |
| Phase 2 — 写作体验与 Markdown 兼容 | 编辑命令 + 渐进隐藏 + 三种视图模式 | 🔲 待开发 |
| Phase 3 — 知识管理与索引 | 双向链接 + 标签 + 全文搜索 | 🔲 待开发 |
| Phase 4 — 可靠同步与冲突中心 | GitLab/WebDAV 状态机 + 冲突处理 | 🔲 待开发 |
| Phase 5 — 公式性能与受限扩展 | 本地 MathJax + Worker 压测 | 🔲 待开发 |
| Phase 6 — 发布与质量验收 | 三平台打包 + 签名 + 自动更新 | 🔲 待开发 |

> Phase 0 验收包含：文档准确、构建基线、HTML 清洗回归、MathJax 本地化、CSP 收紧、Vault 路径边界单元测试、同步 UI 禁用。

> Phase 1-A 验收包含：Pinia → Vault 一次性迁出 + Frontmatter 元数据 + `mardown-beautiful-drafts` 草稿键 + 迁移快照 `.migration-backup-<iso>.json` + 一键回滚到 `imported/.reverted-<iso>/` + 迁移日志 `.migration-log.json` + 命令面板「笔记数据」入口 + `aria-label` 草稿恢复对话框。

> Phase 1-B 验收包含：`notify = "6"` 递归监听 Vault 根 + `vault://changed` Tauri 事件（`{path, kind, at}`）+ 自写去噪（`pending_self_writes`）+ 过滤迁移产物路径 + active-note 外部修改弹「重新载入/保留我的编辑」二选一 toast（绝不静默覆盖）+ `close_vault` 命令 drop 句柄 + 23 个 cargo 测试（含 2 个新 notification 测试）与 68 个 vitest 测试全绿。

> 📌 **当前定位**：可交互桌面原型。Phase 1-A 起，Pinia 内置笔记数据一次性迁出到 Vault 根目录 `imported/`，本地 `.md` 文件即事实来源；UI 偏好仍存于 `mardown-beautiful-note-store`，草稿存于 `mardown-beautiful-drafts`，主题存于 `mardown-beautiful-theme`，互不干扰。

## 🔑 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘K` | 打开命令面板 |
| `⌘N` | 新建笔记 |
| `⌘B` | 切换侧边栏 |
| `⌘T` | 切换主题 |
| `⌘,` | 打开同步设置 |
