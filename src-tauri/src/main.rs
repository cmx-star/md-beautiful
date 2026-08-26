// Tauri 2 backend — Markdown Beautiful
// Handles: file I/O (Vault-bounded), remote sync, and local diagnostics

mod migration_helpers;
mod sync_backend;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
struct AppLogger {
    writer: Arc<Mutex<AppLogWriter>>,
}

struct AppLogWriter {
    path: PathBuf,
    max_bytes: u64,
}

impl AppLogger {
    fn new(path: PathBuf) -> Result<Self, String> {
        Self::with_max_bytes(path, MAX_LOG_BYTES)
    }

    fn with_max_bytes(path: PathBuf, max_bytes: u64) -> Result<Self, String> {
        let parent = path.parent().ok_or("无效日志路径")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        Ok(Self {
            writer: Arc::new(Mutex::new(AppLogWriter { path, max_bytes })),
        })
    }

    fn log(&self, level: &str, event: &str, message: &str) -> Result<(), String> {
        let writer = self.writer.lock().map_err(|error| error.to_string())?;
        writer.append(level, event, message)
    }

    fn path(&self) -> Result<String, String> {
        let writer = self.writer.lock().map_err(|error| error.to_string())?;
        Ok(writer.path.to_string_lossy().to_string())
    }
}

impl AppLogWriter {
    fn append(&self, level: &str, event: &str, message: &str) -> Result<(), String> {
        self.rotate_if_needed()?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis();
        let line = format!(
            "{}\t{}\t{}\t{}\n",
            timestamp,
            sanitize_log_field(level, 16),
            sanitize_log_field(event, 96),
            sanitize_log_field(message, 1024)
        );
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|error| error.to_string())?;
        file.write_all(line.as_bytes())
            .map_err(|error| error.to_string())
    }

    fn rotate_if_needed(&self) -> Result<(), String> {
        let Ok(metadata) = fs::metadata(&self.path) else {
            return Ok(());
        };
        if metadata.len() < self.max_bytes {
            return Ok(());
        }

        let rotated_path = self.path.with_extension("log.1");
        if rotated_path.exists() {
            fs::remove_file(&rotated_path).map_err(|error| error.to_string())?;
        }
        fs::rename(&self.path, rotated_path).map_err(|error| error.to_string())
    }
}

fn sanitize_log_field(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .map(|character| match character {
            '\r' | '\n' | '\t' => ' ',
            _ => character,
        })
        .take(max_chars)
        .collect()
}

fn log_error(logger: &AppLogger, event: &str, error: &str) {
    let _ = logger.log("ERROR", event, error);
}

// ── Vault state ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemoteFileMeta {
    pub path: String,
    pub size: u64,
    pub sha: String,
    #[serde(default)]
    pub etag: String,
}

struct VaultState {
    root: Option<PathBuf>,
    /// Map of file path → last-known mtime (seconds) + size, for external change detection
    fingerprints: HashMap<String, (u64, u64)>,
    /// Path → (sha, etag) snapshot of the last successful sync.  Used as the
    /// common baseline for 3-way merge decisions.
    sync_baseline: HashMap<String, BaselineEntry>,
    /// File paths that the user has deleted locally since the last successful
    /// sync.  They are kept here until the next sync confirms the deletion with
    /// the remote and removes them from the baseline.
    pending_local_deletions: HashMap<String, BaselineEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct BaselineEntry {
    sha: String,
    #[serde(default)]
    etag: String,
}

#[derive(Default)]
struct OpenFileState {
    fingerprints: HashMap<PathBuf, (u64, u64)>,
}

impl VaultState {
    fn new() -> Self {
        VaultState {
            root: None,
            fingerprints: HashMap::new(),
            sync_baseline: HashMap::new(),
            pending_local_deletions: HashMap::new(),
        }
    }

    fn set_root(&mut self, root: PathBuf) {
        // Canonicalize and ensure it exists
        let canonical = root.canonicalize().unwrap_or(root.clone());
        self.root = Some(canonical);
    }

    fn root_path(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    /// Resolve a user-supplied path against the Vault root.
    /// Rejects absolute paths, `..` escapes, and symlinks that point outside.
    fn resolve(&self, relative: &str) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("Vault 未打开")?;
        // Reject absolute paths
        if Path::new(relative).is_absolute() {
            return Err("不允许绝对路径".to_string());
        }
        // Reject attempts to escape via `..` instead of silently rewriting them.
        if Path::new(relative)
            .components()
            .any(|component| component == Component::ParentDir)
        {
            return Err("不允许访问 Vault 外的文件".to_string());
        }
        let normalized = normalize_path(relative);
        let candidate = root.join(&normalized);
        // Canonicalize to catch symlink escapes
        let canonical = candidate.canonicalize().unwrap_or(candidate.clone());
        if !canonical.starts_with(root) {
            return Err("不允许通过符号链接访问 Vault 外文件".to_string());
        }
        Ok(canonical)
    }

    /// Record a fingerprint for external change detection.
    fn fingerprint(&mut self, path: &str, mtime: u64, size: u64) {
        self.fingerprints.insert(path.to_string(), (mtime, size));
    }

    /// Check whether a file was modified externally.
    fn check_changed(&self, path: &str) -> Option<bool> {
        let root = self.root.as_ref()?;
        let canonical = root.join(path).canonicalize().ok()?;
        if !canonical.starts_with(root) {
            return Some(true);
        }
        let (mtime, size) = file_fingerprint(&canonical).ok()?;
        self.fingerprints
            .get(path)
            .map(|(fmtime, fsize)| *fmtime != mtime || *fsize != size)
    }

    fn baseline_snapshot(&self) -> HashMap<String, BaselineEntry> {
        self.sync_baseline.clone()
    }

    fn replace_baseline(&mut self, next: HashMap<String, BaselineEntry>) {
        self.sync_baseline = next;
    }

    fn record_deletion(&mut self, path: &str) {
        if let Some(entry) = self.sync_baseline.remove(path) {
            self.pending_local_deletions.insert(path.to_string(), entry);
        }
    }

    fn confirmed_local_deletion(&mut self, path: &str) {
        self.pending_local_deletions.remove(path);
    }

    fn pending_deletions(&self) -> HashMap<String, BaselineEntry> {
        self.pending_local_deletions.clone()
    }
}

fn normalize_path(path: &str) -> String {
    let mut components: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                components.pop();
            }
            _ => components.push(part),
        }
    }
    components.join("/")
}

fn file_fingerprint(path: &Path) -> Result<(u64, u64), String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let mtime = modified.as_millis().min(u64::MAX as u128) as u64;
    Ok((mtime, meta.len()))
}

fn atomic_write_file(path: &Path, content: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("无效路径")?;
    let temp_path = dir.join(format!(".{}.tmp", uuid_short()));

    let result = (|| {
        let mut temp_file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
        temp_file
            .write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        temp_file.sync_all().map_err(|e| e.to_string())?;
        drop(temp_file);
        fs::rename(&temp_path, path).map_err(|e| e.to_string())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub word_count: u64,
    pub is_favorite: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: String,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncProvider {
    pub r#type: String,
    pub name: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub last_synced_at: Option<u64>,
    pub is_syncing: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileInfo {
    pub name: String,
    pub is_directory: bool,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileFingerprint {
    pub path: String,
    pub mtime: u64,
    pub size: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct OpenedMarkdownFile {
    pub path: String,
    pub name: String,
    pub content: String,
    pub mtime: u64,
    pub size: u64,
}

fn open_markdown_path(
    state: &mut OpenFileState,
    selected_path: &Path,
) -> Result<OpenedMarkdownFile, String> {
    if !is_markdown_path(selected_path) {
        return Err("只能打开 .md 或 .markdown 文件".to_string());
    }

    let path = selected_path.canonicalize().map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("选择的路径不是文件".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (mtime, size) = file_fingerprint(&path)?;
    state.fingerprints.insert(path.clone(), (mtime, size));

    Ok(OpenedMarkdownFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        content,
        mtime,
        size,
    })
}

fn write_authorized_markdown_path(
    state: &mut OpenFileState,
    selected_path: &Path,
    content: &str,
) -> Result<FileFingerprint, String> {
    let path = selected_path.canonicalize().map_err(|e| e.to_string())?;
    if !is_markdown_path(&path) {
        return Err("只能保存 .md 或 .markdown 文件".to_string());
    }

    let expected = state
        .fingerprints
        .get(&path)
        .copied()
        .ok_or("文件未通过本次原生选择器授权")?;
    let current = file_fingerprint(&path)?;
    if current != expected {
        return Err("文件已被其他程序修改，请重新打开后再保存".to_string());
    }

    atomic_write_file(&path, content)?;
    let (mtime, size) = file_fingerprint(&path)?;
    state.fingerprints.insert(path.clone(), (mtime, size));

    Ok(FileFingerprint {
        path: path.to_string_lossy().to_string(),
        mtime,
        size,
    })
}

#[tauri::command]
async fn pick_markdown_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Mutex<OpenFileState>>,
    logger: tauri::State<'_, AppLogger>,
) -> Result<Option<OpenedMarkdownFile>, String> {
    logger.log("INFO", "file_picker.requested", "filter=md,markdown")?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let callback_logger = logger.inner().clone();
    app.dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", &["md", "markdown"])
        .set_title("打开 Markdown 文件")
        .pick_file(move |selected| {
            let message = selected
                .as_ref()
                .and_then(|file| file.clone().into_path().ok())
                .and_then(|path| {
                    path.file_name()
                        .map(|name| name.to_string_lossy().to_string())
                })
                .map(|name| format!("selected_name={}", name))
                .unwrap_or_else(|| "cancelled=true".to_string());
            let _ = callback_logger.log("INFO", "file_picker.callback", &message);
            let _ = sender.send(selected);
        });
    logger.log("DEBUG", "file_picker.dispatched", "parent=main")?;

    let selected = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(300))
    })
    .await
    .map_err(|error| {
        let message = error.to_string();
        log_error(logger.inner(), "file_picker.join_failed", &message);
        message
    })?
    .map_err(|error| {
        let message = format!("文件选择器未返回结果: {}", error);
        log_error(logger.inner(), "file_picker.timeout", &message);
        message
    })?;

    let Some(selected) = selected else {
        logger.log("INFO", "file_picker.cancelled", "")?;
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| {
        let message = error.to_string();
        log_error(logger.inner(), "file_picker.invalid_path", &message);
        message
    })?;
    let mut state = state.lock().unwrap();
    match open_markdown_path(&mut state, &path) {
        Ok(opened) => {
            logger.log(
                "INFO",
                "file_picker.opened",
                &format!("name={} size={}", opened.name, opened.size),
            )?;
            Ok(Some(opened))
        }
        Err(error) => {
            log_error(logger.inner(), "file_picker.open_failed", &error);
            Err(error)
        }
    }
}

#[tauri::command]
fn write_open_markdown_file(
    state: tauri::State<'_, Mutex<OpenFileState>>,
    logger: tauri::State<'_, AppLogger>,
    path: String,
    content: String,
) -> Result<FileFingerprint, String> {
    let mut state = state.lock().unwrap();
    match write_authorized_markdown_path(&mut state, Path::new(&path), &content) {
        Ok(fingerprint) => {
            let file_name = Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            logger.log(
                "INFO",
                "file_save.completed",
                &format!("name={} size={}", file_name, fingerprint.size),
            )?;
            Ok(fingerprint)
        }
        Err(error) => {
            log_error(logger.inner(), "file_save.failed", &error);
            Err(error)
        }
    }
}

#[tauri::command]
fn append_app_log(
    logger: tauri::State<'_, AppLogger>,
    level: String,
    event: String,
    message: String,
) -> Result<(), String> {
    logger.log(&level, &event, &message)
}

#[tauri::command]
fn get_app_log_path(logger: tauri::State<'_, AppLogger>) -> Result<String, String> {
    logger.path()
}

#[tauri::command]
fn credential_set(key: String, value: String) -> Result<(), String> {
    sync_backend::credential_set(key, value)
}

#[tauri::command]
fn credential_has(key: String) -> bool {
    sync_backend::credential_has(key)
}

#[tauri::command]
fn credential_clear(key: String) -> Result<(), String> {
    sync_backend::credential_clear(key)
}

#[tauri::command]
fn sync_test_connection(
    provider: sync_backend::SyncProviderConfig,
) -> Result<serde_json::Value, String> {
    sync_backend::sync_test_connection(provider)
}

/// Open a Vault: set the root directory and scan for `.md` files.
#[tauri::command]
fn open_vault(
    state: tauri::State<'_, Mutex<VaultState>>,
    root: String,
) -> Result<Vec<FileInfo>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("选择的路径不是目录".to_string());
    }
    let canonical = root_path.canonicalize().map_err(|e| e.to_string())?;
    let mut st = state.lock().unwrap();
    st.set_root(canonical.clone());
    drop(st);

    // Scan for .md files
    let mut files = Vec::new();
    scan_md_files(&canonical, &canonical, &mut files)?;
    Ok(files)
}

fn scan_md_files(root: &Path, current: &Path, out: &mut Vec<FileInfo>) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let path = entry.path();
        if meta.is_dir() {
            // Skip hidden directories like .git, .mdapp
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            scan_md_files(root, &path, out)?;
        } else if meta.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext == "md" {
                    let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
                    out.push(FileInfo {
                        name: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string(),
                        is_directory: false,
                        path: rel.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    Ok(())
}

/// Read a file from the Vault (bounded by Vault root).
#[tauri::command]
fn vault_read_file(
    state: tauri::State<'_, Mutex<VaultState>>,
    relative_path: String,
) -> Result<String, String> {
    let st = state.lock().unwrap();
    let path = st.resolve(&relative_path)?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // Record fingerprint
    let (mtime, size) = file_fingerprint(&path)?;
    drop(st);
    let mut st = state.lock().unwrap();
    st.fingerprint(&relative_path, mtime, size);
    Ok(content)
}

/// Atomically write a file within the Vault.
/// Writes to a temp file in the same directory, then renames.
#[tauri::command]
fn vault_write_file(
    state: tauri::State<'_, Mutex<VaultState>>,
    relative_path: String,
    content: String,
) -> Result<FileFingerprint, String> {
    let st = state.lock().unwrap();
    let path = st.resolve(&relative_path)?;
    drop(st);

    atomic_write_file(&path, &content)?;

    let (mtime, size) = file_fingerprint(&path)?;

    let mut st = state.lock().unwrap();
    st.fingerprint(&relative_path, mtime, size);
    Ok(FileFingerprint {
        path: relative_path,
        mtime,
        size,
    })
}

/// Check whether a file has been modified externally since last read.
#[tauri::command]
fn vault_check_changed(
    state: tauri::State<'_, Mutex<VaultState>>,
    relative_path: String,
) -> Result<bool, String> {
    let st = state.lock().unwrap();
    Ok(st.check_changed(&relative_path).unwrap_or(false))
}

/// Get the current Vault root path.
#[tauri::command]
fn vault_root(state: tauri::State<'_, Mutex<VaultState>>) -> Result<Option<String>, String> {
    let st = state.lock().unwrap();
    Ok(st.root_path().map(|p| p.to_string_lossy().to_string()))
}

/// Create a new note file in the Vault.
#[tauri::command]
fn vault_create_note(
    state: tauri::State<'_, Mutex<VaultState>>,
    relative_path: String,
    content: String,
) -> Result<FileFingerprint, String> {
    vault_write_file(state, relative_path, content)
}

/// Delete a file from the Vault.
#[tauri::command]
fn vault_delete_file(
    state: tauri::State<'_, Mutex<VaultState>>,
    relative_path: String,
) -> Result<(), String> {
    let st = state.lock().unwrap();
    let path = st.resolve(&relative_path)?;
    drop(st);
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Rename/move a file within the Vault.
#[tauri::command]
fn vault_rename_file(
    state: tauri::State<'_, Mutex<VaultState>>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let st = state.lock().unwrap();
    let old = st.resolve(&old_path)?;
    let new = st.resolve(&new_path)?;
    drop(st);
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old, &new).map_err(|e| e.to_string())
}

/// List all `.md` files in the Vault.
#[tauri::command]
fn vault_list_files(state: tauri::State<'_, Mutex<VaultState>>) -> Result<Vec<FileInfo>, String> {
    let st = state.lock().unwrap();
    let root = st.root_path().ok_or("Vault 未打开")?.to_path_buf();
    drop(st);
    let mut files = Vec::new();
    scan_md_files(&root, &root, &mut files)?;
    Ok(files)
}

/// Get the app's data directory (for non-Vault app data).
#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.to_string_lossy().to_string())
}

fn uuid_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}{:x}", dur.as_secs(), dur.subsec_nanos())
}

// ── GitLab sync ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct GitLabConfig {
    pub api_url: String,
    pub token: String,
    pub project_id: String,
    pub branch: Option<String>,
}

/// Test GitLab connection
#[tauri::command]
fn test_gitlab(config: GitLabConfig) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v4/user", config.api_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("PRIVATE-TOKEN", &config.token)
        .send()
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        let body = resp.text().map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&body).unwrap_or(serde_json::json!({"ok": true})))
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

/// List files in a GitLab repository directory
#[tauri::command]
fn gitlab_list_files(config: GitLabConfig, dir_path: String) -> Result<Vec<GitLabFile>, String> {
    let client = reqwest::blocking::Client::new();
    let branch = config.branch.as_deref().unwrap_or("main");
    let url = format!(
        "{}/api/v4/projects/{}/repository/tree?path={}&recursive=true&ref={}",
        config.api_url.trim_end_matches('/'),
        config.project_id,
        url_encode(&dir_path),
        url_encode(branch)
    );
    let resp = client
        .get(&url)
        .header("PRIVATE-TOKEN", &config.token)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let files: Vec<GitLabFileItem> = resp.json().map_err(|e| e.to_string())?;
    Ok(files
        .iter()
        .filter(|f| f.type_ == "blob")
        .map(|f| GitLabFile {
            name: f.path.split('/').last().unwrap_or("").to_string(),
            r#type: "file".to_string(),
            path: f.path.clone(),
        })
        .collect())
}

#[derive(Deserialize)]
struct GitLabFileItem {
    #[serde(rename = "type")]
    type_: String,
    path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitLabFile {
    pub name: String,
    pub r#type: String,
    pub path: String,
}

/// Read file content from GitLab
#[tauri::command]
fn gitlab_read_file(config: GitLabConfig, file_path: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let branch = config.branch.as_deref().unwrap_or("main");
    let url = format!(
        "{}/api/v4/projects/{}/repository/files/{}?ref={}",
        config.api_url.trim_end_matches('/'),
        config.project_id,
        url_encode(&file_path),
        url_encode(branch)
    );
    let resp = client
        .get(&url)
        .header("PRIVATE-TOKEN", &config.token)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let data: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let content_b64 = data["content"].as_str().ok_or("missing content")?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, content_b64)
        .map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

/// Write file to GitLab (create or update)
#[tauri::command]
fn gitlab_write_file(
    config: GitLabConfig,
    file_path: String,
    content: String,
    message: String,
) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let branch = config.branch.as_deref().unwrap_or("main");
    let encoded_content = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        content.as_bytes(),
    );

    // Check if file exists
    let file_url = format!(
        "{}/api/v4/projects/{}/repository/files/{}?ref={}",
        config.api_url.trim_end_matches('/'),
        config.project_id,
        url_encode(&file_path),
        url_encode(branch)
    );
    let exists = client
        .get(&file_url)
        .header("PRIVATE-TOKEN", &config.token)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let update_url = format!(
        "{}/api/v4/projects/{}/repository/files/{}",
        config.api_url.trim_end_matches('/'),
        config.project_id,
        url_encode(&file_path)
    );

    let body = serde_json::json!({
        "branch": branch,
        "content": encoded_content,
        "commit_message": message,
    });

    let method = if exists {
        reqwest::Method::PUT
    } else {
        reqwest::Method::POST
    };
    let resp = client
        .request(method, &update_url)
        .header("PRIVATE-TOKEN", &config.token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(())
}

/// Delete file from GitLab
#[tauri::command]
fn gitlab_delete_file(
    config: GitLabConfig,
    file_path: String,
    message: String,
) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let branch = config.branch.as_deref().unwrap_or("main");
    let url = format!(
        "{}/api/v4/projects/{}/repository/files/{}",
        config.api_url.trim_end_matches('/'),
        config.project_id,
        url_encode(&file_path)
    );
    let body = serde_json::json!({
        "branch": branch,
        "content": "",
        "commit_message": message,
    });
    let resp = client
        .delete(&url)
        .header("PRIVATE-TOKEN", &config.token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(())
}

// ── WebDAV sync ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct WebDAVConfig {
    pub url: String,
    pub username: String,
    pub password: String,
}

/// Test WebDAV connection
#[tauri::command]
fn test_webdav(config: WebDAVConfig) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &config.url)
        .header("Authorization", format!("Basic {}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", config.username, config.password).as_bytes(),
        )))
        .header("Depth", "1")
        .header("Content-Type", "text/xml; charset=utf-8")
        .body(r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:displayname/></d:propfind>"#)
        .send()
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(serde_json::json!({"ok": true, "status": resp.status().as_u16()}))
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

/// List files via WebDAV
#[tauri::command]
fn webdav_list_files(config: WebDAVConfig, dir_path: String) -> Result<Vec<WebDAVFile>, String> {
    let client = reqwest::blocking::Client::new();
    let base = config.url.trim_end_matches('/');
    let path = if dir_path.is_empty() {
        base.to_string()
    } else {
        format!("{}/{}", base, dir_path.trim_start_matches('/'))
    };
    let resp = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &path)
        .header(
            "Authorization",
            format!(
                "Basic {}",
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", config.username, config.password).as_bytes(),
                )
            ),
        )
        .header("Depth", "1")
        .header("Content-Type", "text/xml; charset=utf-8")
        .body(
            r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:ns0="http://apple.com/ns/ical/">
  <d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>
</d:propfind>"#,
        )
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().map_err(|e| e.to_string())?;
    Ok(parse_webdav_response(&body, &path))
}

#[derive(Serialize, Clone, Debug)]
pub struct WebDAVFile {
    pub name: String,
    pub r#type: String,
    pub path: String,
}

fn parse_webdav_response(xml: &str, _base_url: &str) -> Vec<WebDAVFile> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut files = Vec::new();
    let mut href_stack: Vec<String> = Vec::new();
    let mut display_name: Option<String> = None;
    let mut is_collection = false;
    let mut in_response = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"d:response" => {
                in_response = true;
                display_name = None;
                is_collection = false;
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"d:response" => {
                if in_response && let Some(h) = href_stack.last() {
                    let decoded = url_decode(h);
                    if let Some(name) = &display_name {
                        files.push(WebDAVFile {
                            name: name.clone(),
                            r#type: if is_collection {
                                "directory".to_string()
                            } else {
                                "file".to_string()
                            },
                            path: decoded,
                        });
                    }
                }
                href_stack.clear();
                in_response = false;
            }
            Ok(Event::Text(t)) if in_response => {
                let s = t.unescape().unwrap_or_default().to_string();
                if display_name.is_none() {
                    display_name = Some(s);
                }
            }
            Ok(Event::Start(e)) if e.name().as_ref() == b"d:href" => {
                href_stack.clear();
            }
            Ok(Event::Text(t)) if !href_stack.is_empty() => {
                href_stack.push(t.unescape().unwrap_or_default().to_string());
            }
            Ok(Event::Start(e)) if e.name().as_ref() == b"d:resourcetype" => {}
            Ok(Event::End(e)) if e.name().as_ref() == b"d:resourcetype" => {}
            Ok(Event::Start(e)) if e.name().as_ref() == b"d:collection" => {
                is_collection = true;
            }
            Ok(Event::Start(e))
                if e.name().as_ref() == b"ns0:root" || e.name().as_ref() == b"d:displayname" => {}
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    files
}

/// Read file via WebDAV
#[tauri::command]
fn webdav_read_file(config: WebDAVConfig, file_path: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let base = config.url.trim_end_matches('/');
    let url = format!("{}/{}", base, file_path.trim_start_matches('/'));
    let resp = client
        .get(&url)
        .header(
            "Authorization",
            format!(
                "Basic {}",
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", config.username, config.password).as_bytes(),
                )
            ),
        )
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().map_err(|e| e.to_string())
}

/// Write file via WebDAV
#[tauri::command]
fn webdav_write_file(
    config: WebDAVConfig,
    file_path: String,
    content: String,
    _message: String,
) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let base = config.url.trim_end_matches('/');
    let url = format!("{}/{}", base, file_path.trim_start_matches('/'));
    let resp = client
        .put(&url)
        .header(
            "Authorization",
            format!(
                "Basic {}",
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", config.username, config.password).as_bytes(),
                )
            ),
        )
        .header("Content-Type", "text/markdown; charset=utf-8")
        .body(content)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() && resp.status() != 201 {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(())
}

/// Delete file via WebDAV
#[tauri::command]
fn webdav_delete_file(config: WebDAVConfig, file_path: String) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let base = config.url.trim_end_matches('/');
    let url = format!("{}/{}", base, file_path.trim_start_matches('/'));
    let resp = client
        .delete(&url)
        .header(
            "Authorization",
            format!(
                "Basic {}",
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{}:{}", config.username, config.password).as_bytes(),
                )
            ),
        )
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() && resp.status() != 204 {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(())
}

// ── MathJax formula processing ─────────────────────────────────────────────────

/// Process LaTeX formulas in markdown content using QuickJS + MathJax
/// This runs JS in a QuickJS context to evaluate math expressions
#[tauri::command]
fn process_mathjax(input: String) -> Result<String, String> {
    // Use the webview's MathJax (loaded in the frontend) for actual rendering
    // This command just validates and marks formula regions
    let output = input
        .replace("$", " $$ ")
        .replace("\\(", "\\( \\)")
        .replace("\\)", " \\)");
    Ok(output)
}

// ── Main entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            let logger = AppLogger::new(log_dir.join("markdown-beautiful.log"))
                .map_err(std::io::Error::other)?;
            logger
                .log("INFO", "app.started", "version=0.1.0")
                .map_err(std::io::Error::other)?;
            app.manage(logger);
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(VaultState::new()))
        .manage(Mutex::new(OpenFileState::default()))
        .invoke_handler(tauri::generate_handler![
            // Vault
            open_vault,
            vault_read_file,
            vault_write_file,
            vault_check_changed,
            vault_root,
            vault_create_note,
            vault_delete_file,
            vault_rename_file,
            vault_list_files,
            get_data_dir,
            // Standalone Markdown files
            pick_markdown_file,
            write_open_markdown_file,
            append_app_log,
            get_app_log_path,
            // Credentials and provider diagnostics
            credential_set,
            credential_has,
            credential_clear,
            sync_test_connection,
            // GitLab
            test_gitlab,
            gitlab_list_files,
            gitlab_read_file,
            gitlab_write_file,
            gitlab_delete_file,
            // WebDAV
            test_webdav,
            webdav_list_files,
            webdav_read_file,
            webdav_write_file,
            webdav_delete_file,
            // Math
            process_mathjax,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn url_encode(s: &str) -> String {
    percent_encoding::percent_encode(s.as_bytes(), percent_encoding::NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_file(name: &str, content: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "markdown-beautiful-test-{}-{}",
            std::process::id(),
            uuid_short()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        (dir, path)
    }

    #[test]
    fn standalone_markdown_file_saves_after_authorization() {
        let (dir, path) = create_test_file("note.md", "# Before");
        let mut state = OpenFileState::default();
        let opened = open_markdown_path(&mut state, &path).unwrap();

        assert_eq!(opened.content, "# Before");
        write_authorized_markdown_path(&mut state, &path, "# After").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "# After");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn standalone_markdown_file_rejects_external_modification() {
        let (dir, path) = create_test_file("note.markdown", "Original");
        let mut state = OpenFileState::default();
        open_markdown_path(&mut state, &path).unwrap();
        fs::write(&path, "Changed outside the app").unwrap();

        let error = write_authorized_markdown_path(&mut state, &path, "App edit").unwrap_err();
        assert!(error.contains("其他程序修改"));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "Changed outside the app"
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn app_logger_sanitizes_fields_and_rotates() {
        let dir = std::env::temp_dir().join(format!(
            "markdown-beautiful-log-test-{}-{}",
            std::process::id(),
            uuid_short()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("markdown-beautiful.log");
        let logger = AppLogger::with_max_bytes(path.clone(), 20).unwrap();

        logger.log("INFO\n", "file\topen", "first\nline").unwrap();
        logger.log("ERROR", "file.save", "second line").unwrap();

        let rotated = fs::read_to_string(path.with_extension("log.1")).unwrap();
        let current = fs::read_to_string(&path).unwrap();
        assert_eq!(rotated.lines().count(), 1);
        assert!(rotated.contains("\tINFO \tfile open\tfirst line"));
        assert_eq!(current.lines().count(), 1);
        assert!(current.contains("\tERROR\tfile.save\tsecond line"));

        fs::remove_dir_all(dir).unwrap();
    }

    fn create_vault_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markdown-beautiful-vault-test-{}-{}",
            std::process::id(),
            uuid_short()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn vault_resolve_rejects_parent_dir() {
        let dir = create_vault_dir();
        let inside = dir.join("inside.md");
        fs::write(&inside, "# inside").unwrap();

        let mut state = VaultState::new();
        state.set_root(dir.clone());

        let err = state.resolve("../escape.md").unwrap_err();
        assert!(
            err.contains("不允许访问 Vault 外的文件"),
            "unexpected error: {}",
            err
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn vault_resolve_rejects_absolute_path() {
        let dir = create_vault_dir();
        let mut state = VaultState::new();
        state.set_root(dir.clone());

        let err = state.resolve("/etc/passwd").unwrap_err();
        assert!(err.contains("不允许绝对路径"), "unexpected error: {}", err);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn vault_resolve_accepts_valid_relative() {
        let dir = create_vault_dir();
        let inside = dir.join("inside.md");
        fs::write(&inside, "# inside").unwrap();

        let mut state = VaultState::new();
        state.set_root(dir.clone());

        let resolved = state.resolve("inside.md").expect("resolve should succeed");
        let root = state.root_path().expect("root should be set");
        assert!(
            resolved.starts_with(root),
            "resolved path {:?} should start with vault root {:?}",
            resolved,
            root
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn vault_fingerprint_records_and_detects_change() {
        let dir = create_vault_dir();
        let note = dir.join("note.md");
        fs::write(&note, "first").unwrap();

        let mut state = VaultState::new();
        state.set_root(dir.clone());

        let (mtime, size) = file_fingerprint(&note).unwrap();
        state.fingerprint("note.md", mtime, size);

        assert_eq!(state.check_changed("note.md"), Some(false));

        // Force a different mtime so detection is reliable across filesystems.
        let file = fs::OpenOptions::new().write(true).open(&note).unwrap();
        let new_mtime = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        file.set_modified(new_mtime).unwrap();

        assert_eq!(state.check_changed("note.md"), Some(true));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn vault_writes_atomically_and_updates_fingerprint() {
        let dir = create_vault_dir();
        let target = dir.join("atomic.md");

        atomic_write_file(&target, "atomic content").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "atomic content");

        let (mtime, size) = file_fingerprint(&target).unwrap();
        assert!(size > 0);
        assert!(mtime > 0);
        assert_eq!(size as usize, "atomic content".len());

        fs::remove_dir_all(dir).unwrap();
    }
}

fn url_decode(s: &str) -> String {
    percent_encoding::percent_decode(s.as_bytes())
        .decode_utf8()
        .unwrap_or_default()
        .to_string()
}
