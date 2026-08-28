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
npm run test          # vitest 单元测试（含 slugify / frontmatter / migrationService / draftService / data-settings / assetPath / attachmentService smoke）
npm run typecheck     # 前端类型检查
cd src-tauri && cargo test   # Rust 单元测试（含 migration_helpers / attachment helpers）
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

## 📎 附件导入（Phase 1-C）

打开 Vault 后，附件统一保存在 `<Vault>/assets/` 下，两种入口：

- **OS 拖拽**：把任意文件从 Finder 拖到编辑区（出现珊瑚色虚线高亮），后端复制进 `assets/`；
- **粘贴图片**：⌘V 粘贴剪贴板图片（截图、复制的图像文件），经 base64 写入 `assets/`。

重名自动编号（`photo.png` → `photo-1.png` → `photo-2.png`），链接按笔记位置生成相对路径
（根目录笔记用 `./assets/x.png`，嵌套笔记用 `../assets/x.png`），预览通过 `data:` URL
内嵌显示本地附件（CSP 已允许 `img-src data:`）。「笔记数据」面板提供**附件审计**：
列出未被任何笔记引用的孤儿附件；按数据安全策略，应用从不自动删除孤儿附件。

## ✍️ 写作体验（Phase 2）

- **编辑命令 + 格式化工具栏**：标题 H1/H2/H3、加粗、斜体、行内代码、链接、有序/无序/任务列表、引用、表格、代码块、行内公式，全部基于纯文本变换核心（`markdownTransform.ts`）实现并支持多行选择。
- **快捷键注册中心**（`shortcutRegistry.ts`）：13 个全局命令 + 9 个编辑器格式化命令统一注册；`Mod` 跨平台映射（macOS ⌘ / 其他 Ctrl）。工具栏 ⚙️ 设置 →「快捷键」可录制新键位、解绑、恢复默认；冲突键位以红色标示并**阻止保存**。改动即时生效并持久化（`mardown-beautiful-theme`）。
- **三种视图模式**：源码（⌘1）/ 分栏实时预览（⌘2）/ 阅读（⌘3），工具栏分段按钮与命令面板同步。
- **滚动同步**：编辑器滚动按比例驱动预览滚动，工具栏 🔗 一键开关。
- **Frontmatter 属性面板**：编辑区「属性」按钮展开；已知字段 + 任意自定义字段增删改；**未改动字段逐字节原样保留**（不重排未知语法），标签字段提供逗号分隔编辑。
- **语法高亮可配置**：设置 →「语法高亮」，标题/加粗/斜体/链接/行内代码/引用六组 Token 颜色，浅色与深色独立配置，一键重置默认。
- **渐进隐藏标记**：非活动行的 `**`、`#`、`-`、`[ ]` 等语法标记自动隐藏，光标移入即显示（Obsidian 式 live preview）；纯 Decoration 实现，不影响撤销栈与输入法。
- **Markdown 方言**：CommonMark + GFM 表格/任务列表 + `[[Wiki 链接]]`（支持 `[[目标|别名]]`，点击按标题跳转）+ 脚注 `[^1]`（自动编号、脚注节、回跳）+ 数学公式。
- **防抖渲染**：预览 180ms 防抖，大文档输入不逐键全量重排；CodeMirror 本身增量解析。

## 🕸️ 知识管理与索引（Phase 3）

索引是笔记内容的**纯派生视图**（`noteIndex.ts` + `useNoteIndex` composable）：
不落盘、不持久化，删除后随时可从 Vault 完整重建，满足"关系图只作为索引的视图"约束。

- **解析**：`[[Wiki 链接]]`（含 `|别名`）、Markdown 相对路径链接、frontmatter 标签、行内 `#标签`（代码块内不误报）、frontmatter 全部键值。
- **链接解析规则**：frontmatter 显式 `id` → Vault 相对路径 → 精确标题（大小写不敏感）→ 唯一文件名；多候选一律返回"歧义"而非猜测。
- **反向链接面板**：预览底部展示引用当前笔记的笔记（可点击跳转）与当前笔记的未解析链接；未解析链接点击可一键创建同名笔记。
- **搜索**：空格分词、全部词必须命中；标题 > 标签 > 属性 > 正文的权重排序（`searchNotes`）。
- **重命名**：命令面板 →「重命名当前笔记」。确认对话框**预览所有受影响链接**；改写前把每个被改写文件备份到 `<Vault>/.mdapp/backups/`（watcher 已过滤该目录）；之后改写引用并重命名文件。全程可取消。

## ☁️ 同步方案（Phase 4 已接入状态机）

> 同步遵循统一流程：读取本地与远端状态 → 对比基线 → 生成操作计划 → 用户确认破坏性操作 → 拉取/三方对比 → 条件写入上传 → 更新基线。
> **任何情况下都不会静默覆盖或伪造"同步完成"**：基线只为真正执行成功的动作推进。

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

### 同步安全语义（Phase 4）

- **单一同步方式**：同一 Vault 同时启用多个应用内同步服务会被直接拒绝（防同步环路）。
- **凭据**：GitHub Token / WebDAV 密码只存系统 Keychain（`keyring`），永不出现在前端 store、日志或配置；日志字段统一脱敏。
- **条件写入**：GitHub PUT 携带基线 sha（远端已变化时进入冲突），WebDAV 使用 ETag / If-Match。
- **冲突中心**：双方相对基线均有修改时进入人工决策——保留本地（上传）/ 采用远端（覆盖本地）/ 双方保留（远端副本另存 `*.remote-<时间戳>.md`）；删除类破坏性操作同样必须逐条确认。
- **失败可重试**：动作逐条应用，失败记录在日志；重试只补齐未完成的动作，不产生重复文件或虚假完成状态。

## 🗺️ 开发里程碑

详细路线图见 [DEVELOPMENT_PLAN_SUPPLEMENT.md](./DEVELOPMENT_PLAN_SUPPLEMENT.md)

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 — 基线校准与安全止血 | 文档修正 + HTML 清洗 + CSP 收紧 + 构建基线 | ✅ 已完成（基线校准与安全止血） |
| Phase 1-A — Pinia 迁出 + 草稿恢复 + 快照回滚 | 一次性迁出到 Vault + 草稿键隔离 + 迁移日志 + 一键回滚 UI | ✅ 已完成（数据迁出与回滚） |
| Phase 1-B — Vault 监听 + 外部修改检测 | `notify` 递归监听 + `vault://changed` 事件 + 自写去噪 + 迁移产物过滤 + active-note 弹 toast + `close_vault` | ✅ 已完成（外部修改检测） |
| Phase 1-C — 附件导入 | 拖拽 / 粘贴图片 → `assets/` 子目录 + 相对路径链接 + 重名自动编号 + 孤儿附件审计（只报告不删除）+ 预览内嵌显示 | ✅ 已完成（附件导入） |
| Phase 2 — 写作体验与 Markdown 兼容 | 编辑命令 + 格式化工具栏 + 快捷键注册中心 + 三种视图模式 + 滚动同步 + Frontmatter 属性面板 + 可配置语法高亮 + 渐进隐藏标记 + Wiki 链接/脚注方言 + 防抖渲染 | ✅ 已完成（写作体验） |
| Phase 3 — 知识管理与索引 | Wiki 链接/标签/属性解析 + 可重建索引（出链/反链/未解析链接）+ 反向链接面板 + 双链跳转（ID→路径→标题，歧义提示，未解析可建笔记）+ 搜索（标题/正文/标签/属性）+ 重命名改写链接（预览+备份） | ✅ 已完成（知识管理） |
| Phase 4 — 可靠同步与冲突中心 | `sync_build_plan`/`sync_apply_action`/基线持久化接入 Tauri 命令 + 前端同步状态机执行器（拉取/条件上传/取消/安全重试）+ 冲突中心（三版本对比 + 保留本地/远端/双方 + 删除确认）+ Keychain 凭据 + 单一同步方式约束 | ✅ 已完成（可靠同步） |
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
| `⌘\` | 切换侧边栏 |
| `⌘1/2/3` | 源码 / 分栏 / 阅读模式 |
| `⌘F` | 聚焦搜索 |
| `⌘B` / `⌘I` / `⌘E` | 加粗 / 斜体 / 行内代码 |
| `⌘⇧L` / `⌘⇧H` | 插入链接 / 标题循环 |
| `⌘⇧T` | 切换主题 |
| `⌘O` / `⌘⇧O` | 打开文件 / 打开 Vault |
| `⌘⇧S` | 同步 |

> 完整键位表与自定义入口见「设置 → 快捷键」（⌘K 搜索「设置」或工具栏 ⚙️）。
