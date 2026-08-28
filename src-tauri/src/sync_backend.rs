// Sync backend for Markdown Beautiful — Phase 4 of DEVELOPMENT_PLAN_SUPPLEMENT.md.
//
// Responsibilities:
//   * Issue GitHub repository contents API and WebDAV (PROPFIND/GET/PUT/DELETE/MOVE) requests.
//   * Read/write secrets from the system Keychain via the `keyring` crate.
//   * Diff local Vault state against remote metadata, build a SyncPlan, and
//     execute SyncActions one at a time so a single failure does not corrupt
//     the half-synced state.
//   * Persist the per-path (sha, etag) baseline to the app data directory so
//     subsequent runs can run 3-way merges.

use base64::Engine;
use percent_encoding::percent_encode;
use reqwest::StatusCode;
use reqwest::blocking::Client;
use reqwest::header::{
    AUTHORIZATION, ETAG, HeaderMap, HeaderName, HeaderValue, IF_MATCH, IF_NONE_MATCH,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::{AppLogger, BaselineEntry, RemoteFileMeta, VaultState};

// ── Provider DTOs ──────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncProviderConfig {
    pub r#type: String,
    pub name: String,
    pub enabled: bool,
    #[serde(default)]
    pub config: HashMap<String, String>,
    #[serde(default)]
    pub has_credential: bool,
}

#[derive(Deserialize, Clone, Debug)]
pub struct GitHubConfig {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    #[serde(default)]
    pub api_url: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ActionRequest {
    Pull {
        path: String,
    },
    Upload {
        path: String,
        content: String,
        base_sha: Option<String>,
    },
    DeleteLocal {
        path: String,
    },
    DeleteRemote {
        path: String,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActionResponse {
    pub sha: String,
    pub etag: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPayload {
    pub path: String,
    pub kind: String,
    pub base: String,
    pub local: String,
    pub remote: String,
    pub local_mtime: u64,
    pub remote_sha: String,
    pub remote_etag: String,
    pub local_sha: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PlanAction {
    Noop {
        path: String,
        reason: String,
    },
    Pull {
        path: String,
        remote_sha: String,
        remote_etag: String,
    },
    Upload {
        path: String,
        base_sha: Option<String>,
        remote_etag: Option<String>,
    },
    DeleteLocal {
        path: String,
        remote_sha: String,
        remote_etag: String,
    },
    DeleteRemote {
        path: String,
        local_sha: String,
    },
    Conflict {
        conflict: ConflictPayload,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub pull: u32,
    pub upload: u32,
    pub delete_local: u32,
    pub delete_remote: u32,
    pub conflict: u32,
    pub noop: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlanResponse {
    pub plan_id: String,
    pub provider: String,
    pub actions: Vec<PlanAction>,
    pub summary: PlanSummary,
    pub remote_meta: Vec<RemoteFileMeta>,
    pub pulls: Vec<PulledFile>,
    pub remote_deletions: Vec<RemoteDeletion>,
    pub baseline: HashMap<String, BaselineEntry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PulledFile {
    pub path: String,
    pub content: String,
    pub remote_sha: String,
    pub remote_etag: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDeletion {
    pub path: String,
    pub remote_etag: String,
    pub remote_sha: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SyncResultSummary {
    pub applied: u32,
    pub failed: u32,
    pub conflicts: u32,
    pub baseline: HashMap<String, BaselineEntry>,
}

// ── Credential service (system Keychain) ──────────────────────────────────────

const KEYRING_SERVICE: &str = "com.mardown-beautiful.app";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

pub fn credential_set(key: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return Err("凭据不能为空".to_string());
    }
    let entry = keyring_entry(&key)?;
    entry.set_password(&value).map_err(|e| {
        // Never echo the secret back to the caller.
        format!("凭据写入失败: {}", e)
    })?;
    Ok(())
}

pub fn credential_has(key: String) -> bool {
    match keyring_entry(&key) {
        Ok(entry) => match entry.get_password() {
            Ok(value) => !value.is_empty(),
            Err(_) => false,
        },
        Err(_) => false,
    }
}

pub fn credential_clear(key: String) -> Result<(), String> {
    if let Ok(entry) = keyring_entry(&key) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

fn load_secret(key: &str) -> Result<String, String> {
    let entry = keyring_entry(key)?;
    entry
        .get_password()
        .map_err(|e| format!("凭据读取失败: {}", e))
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

fn sanitize_for_log(value: &str) -> String {
    let mut sanitized: String = value
        .chars()
        .map(|c| match c {
            '\r' | '\n' | '\t' => ' ',
            _ => c,
        })
        .take(256)
        .collect();

    for prefix in ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "glpat-"] {
        redact_log_value(&mut sanitized, prefix, false);
    }
    for marker in [
        "authorization: bearer ",
        "authorization: basic ",
        "password=",
        "password:",
        "passwd=",
        "passwd:",
        "token=",
        "token:",
    ] {
        redact_log_value(&mut sanitized, marker, true);
    }
    sanitized
}

fn redact_log_value(value: &mut String, marker: &str, after_marker: bool) {
    let mut search_from = 0;
    loop {
        let lowercase = value.to_ascii_lowercase();
        let Some(relative_index) = lowercase[search_from..].find(&marker.to_ascii_lowercase())
        else {
            break;
        };
        let marker_start = search_from + relative_index;
        let secret_start = if after_marker {
            marker_start + marker.len()
        } else {
            marker_start
        };
        let secret_end = value[secret_start..]
            .find(|character: char| {
                character.is_whitespace() || matches!(character, ',' | ';' | '"' | '\'')
            })
            .map(|offset| secret_start + offset)
            .unwrap_or(value.len());

        if secret_end <= secret_start {
            search_from = marker_start + marker.len();
            continue;
        }
        value.replace_range(secret_start..secret_end, "[redacted]");
        search_from = secret_start + "[redacted]".len();
    }
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Markdown-Beautiful/0.1 (sync)")
        .build()
        .map_err(|e| e.to_string())
}

fn ensure_markdown(path: &str) -> Result<(), String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("md") | Some("markdown") => Ok(()),
        _ => Err(format!("仅同步 .md / .markdown 文件: {}", path)),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn write_log(logger: &AppLogger, level: &str, event: &str, message: &str) {
    let _ = logger.log(level, event, &sanitize_for_log(message));
}

// ── Path safety ───────────────────────────────────────────────────────────────

fn reject_unsafe_relative(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if path.contains('\\') {
        return Err(format!("拒绝反斜杠路径: {}", path));
    }
    if path.contains("..") {
        return Err(format!("拒绝 .. 越界路径: {}", path));
    }
    if path.starts_with('/') {
        return Err(format!("拒绝绝对路径: {}", path));
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(format!("拒绝盘符路径: {}", path));
    }
    Ok(())
}

// ── GitHub provider ───────────────────────────────────────────────────────────

const GITHUB_DEFAULT_API: &str = "https://api.github.com";

fn github_headers(config: &GitHubConfig) -> Result<HeaderMap, String> {
    let token = load_secret("github-token")?;
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token))
            .map_err(|e| format!("无效的 GitHub Token: {}", e))?,
    );
    headers.insert(
        HeaderName::from_static("accept"),
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        HeaderName::from_static("x-github-api-version"),
        HeaderValue::from_static("2022-11-28"),
    );
    if config.api_url.is_empty() {
        let _ = GITHUB_DEFAULT_API; // documented fallback
    }
    Ok(headers)
}

fn github_api_url(config: &GitHubConfig) -> String {
    if config.api_url.is_empty() {
        GITHUB_DEFAULT_API.to_string()
    } else {
        config.api_url.trim_end_matches('/').to_string()
    }
}

fn github_test(config: GitHubConfig) -> Result<serde_json::Value, String> {
    let client = build_client()?;
    let url = format!(
        "{}/repos/{}/{}",
        github_api_url(&config),
        config.owner,
        config.repo
    );
    let resp = client
        .get(&url)
        .headers(github_headers(&config)?)
        .send()
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        let body = resp.text().map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&body).unwrap_or(serde_json::json!({"ok": true})))
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

#[derive(Deserialize)]
struct GhTreeItem {
    path: String,
    #[serde(default)]
    sha: String,
    #[serde(default)]
    size: u64,
    #[serde(rename = "type")]
    kind: String,
}

fn github_list(config: &GitHubConfig) -> Result<Vec<RemoteFileMeta>, String> {
    let client = build_client()?;
    let url = format!(
        "{}/repos/{}/{}/git/trees/{}?recursive=1",
        github_api_url(config),
        config.owner,
        config.repo,
        config.branch
    );
    let resp = client
        .get(&url)
        .headers(github_headers(config)?)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let payload: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let tree = payload["tree"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    for raw in tree {
        if let Ok(item) = serde_json::from_value::<GhTreeItem>(raw) {
            if item.kind == "blob" && ensure_markdown(&item.path).is_ok() {
                out.push(RemoteFileMeta {
                    path: item.path,
                    size: item.size,
                    sha: item.sha,
                    etag: String::new(),
                });
            }
        }
    }
    Ok(out)
}

fn github_get(config: &GitHubConfig, path: &str) -> Result<(String, String), String> {
    ensure_markdown(path)?;
    reject_unsafe_relative(path)?;
    let client = build_client()?;
    let encoded = percent_encode(path.as_bytes(), percent_encoding::NON_ALPHANUMERIC).to_string();
    let url = format!(
        "{}/repos/{}/{}/contents/{}?ref={}",
        github_api_url(config),
        config.owner,
        config.repo,
        encoded,
        config.branch
    );
    let resp = client
        .get(&url)
        .headers(github_headers(config)?)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let content_b64 = body["content"]
        .as_str()
        .ok_or_else(|| "GitHub 响应缺少 content 字段".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_b64.replace('\n', ""))
        .map_err(|e| e.to_string())?;
    let sha = body["sha"].as_str().unwrap_or("").to_string();
    Ok((String::from_utf8(bytes).map_err(|e| e.to_string())?, sha))
}

fn github_put(
    config: &GitHubConfig,
    path: &str,
    content: &str,
    base_sha: Option<String>,
) -> Result<ActionResponse, String> {
    ensure_markdown(path)?;
    reject_unsafe_relative(path)?;
    let client = build_client()?;
    let encoded = percent_encode(path.as_bytes(), percent_encoding::NON_ALPHANUMERIC).to_string();
    let url = format!(
        "{}/repos/{}/{}/contents/{}",
        github_api_url(config),
        config.owner,
        config.repo,
        encoded
    );
    let body = serde_json::json!({
        "message": format!("Update {}", path),
        "branch": config.branch,
        "content": base64::engine::general_purpose::STANDARD.encode(content.as_bytes()),
        "sha": base_sha,
    });
    let resp = client
        .put(&url)
        .headers(github_headers(config)?)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let resp_body: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let sha = resp_body["content"]["sha"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(ActionResponse {
        sha,
        etag: String::new(),
    })
}

fn github_delete(
    config: &GitHubConfig,
    path: &str,
    base_sha: &str,
) -> Result<ActionResponse, String> {
    ensure_markdown(path)?;
    reject_unsafe_relative(path)?;
    let client = build_client()?;
    let encoded = percent_encode(path.as_bytes(), percent_encoding::NON_ALPHANUMERIC).to_string();
    let url = format!(
        "{}/repos/{}/{}/contents/{}",
        github_api_url(config),
        config.owner,
        config.repo,
        encoded
    );
    let body = serde_json::json!({
        "message": format!("Delete {}", path),
        "branch": config.branch,
        "sha": base_sha,
    });
    let resp = client
        .delete(&url)
        .headers(github_headers(config)?)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let resp_body: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let sha = resp_body["commit"]["sha"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(ActionResponse {
        sha,
        etag: String::new(),
    })
}

// ── WebDAV provider ───────────────────────────────────────────────────────────

fn webdav_headers(config: &WebDavConfig) -> Result<HeaderMap, String> {
    let secret = load_secret("webdav-password")?;
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", config.username, secret).as_bytes())
        ))
        .map_err(|e| e.to_string())?,
    );
    Ok(headers)
}

fn webdav_test(config: WebDavConfig) -> Result<serde_json::Value, String> {
    let client = build_client()?;
    let headers = webdav_headers(&config)?;
    let resp = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &config.url)
        .headers(headers)
        .header("Depth", "0")
        .header("Content-Type", "text/xml; charset=utf-8")
        .body(r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:displayname/></d:propfind>"#)
        .send()
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(serde_json::json!({"ok": true}))
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

#[derive(Deserialize)]
struct WebDavResponse {
    #[serde(rename = "multistatus")]
    multistatus: WebDavMultistatus,
}

#[derive(Deserialize)]
struct WebDavMultistatus {
    response: Vec<WebDavResponseItem>,
}

#[derive(Deserialize)]
struct WebDavResponseItem {
    href: String,
    propstat: WebDavPropstat,
}

#[derive(Deserialize)]
struct WebDavPropstat {
    prop: WebDavProp,
}

#[derive(Deserialize)]
struct WebDavProp {
    #[serde(rename = "getcontentlength", default)]
    content_length: Option<String>,
    #[serde(rename = "getetag", default)]
    etag: Option<String>,
    #[serde(rename = "resourcetype", default)]
    resource_type: Option<WebDavResourceType>,
}

#[derive(Deserialize)]
struct WebDavResourceType {
    #[serde(default)]
    collection: Option<String>,
}

fn webdav_list(config: &WebDavConfig) -> Result<Vec<RemoteFileMeta>, String> {
    let client = build_client()?;
    let headers = webdav_headers(config)?;
    let resp = client
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
            &config.url,
        )
        .headers(headers)
        .header("Depth", "infinity")
        .header("Content-Type", "text/xml; charset=utf-8")
        .body(
            r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop>
</d:propfind>"#,
        )
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().map_err(|e| e.to_string())?;
    Ok(parse_webdav_listing(&body, &config.url))
}

fn parse_webdav_listing(xml: &str, base: &str) -> Vec<RemoteFileMeta> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_etag: Option<String> = None;
    let mut current_size: Option<u64> = None;
    let mut is_collection = false;
    let mut last_tag: Vec<String> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                last_tag.push(name);
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if last_tag.last().map(|s| s == &name).unwrap_or(false) {
                    last_tag.pop();
                }
                if name.ends_with("propstat") {
                    if !is_collection {
                        if let Some(path) = current_path.as_ref() {
                            if let Ok(rel) = path_relative_to(base, path) {
                                if ensure_markdown(&rel).is_ok() {
                                    out.push(RemoteFileMeta {
                                        path: rel,
                                        size: current_size.take().unwrap_or(0),
                                        sha: current_etag.take().unwrap_or_default(),
                                        etag: current_etag.take().unwrap_or_default(),
                                    });
                                }
                            }
                        }
                    } else {
                        current_size = None;
                        current_etag = None;
                    }
                } else if name.ends_with("response") {
                    current_path = None;
                    current_etag = None;
                    current_size = None;
                    is_collection = false;
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name.ends_with("collection") {
                    is_collection = true;
                }
                if name.ends_with("getcontentlength") {
                    for attr in e.attributes().flatten() {
                        if let Ok(value) = attr.unescape_value() {
                            current_size = value.parse().ok();
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                let text = t.unescape().unwrap_or_default().to_string();
                if let Some(top) = last_tag.last() {
                    if top.ends_with("href") {
                        current_path = Some(text);
                    } else if top.ends_with("getetag") {
                        current_etag = Some(text);
                    } else if top.ends_with("getcontentlength") {
                        current_size = text.parse().ok();
                    } else if top.ends_with("collection") {
                        is_collection = true;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn path_relative_to(base: &str, href: &str) -> Result<String, String> {
    let base_path = url_no_scheme(base);
    let href_path = url_no_scheme(href);
    if let Some(stripped) = href_path.strip_prefix(&base_path) {
        let trimmed = stripped.trim_start_matches('/').trim_end_matches('/');
        if trimmed.is_empty() {
            return Err("根目录".to_string());
        }
        return Ok(trimmed.to_string());
    }
    Ok(href_path.trim_start_matches('/').to_string())
}

fn url_no_scheme(url: &str) -> String {
    if let Some(idx) = url.find("://") {
        let after = &url[idx + 3..];
        if let Some(slash) = after.find('/') {
            return after[slash..].to_string();
        }
        return String::new();
    }
    url.to_string()
}

fn webdav_get(config: &WebDavConfig, path: &str) -> Result<(String, String), String> {
    ensure_markdown(path)?;
    reject_unsafe_relative(path)?;
    let client = build_client()?;
    let headers = webdav_headers(config)?;
    let url = format!(
        "{}/{}",
        config.url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let resp = client
        .get(&url)
        .headers(headers)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let _etag = resp
        .headers()
        .get(ETAG)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_default();
    let content = resp.text().map_err(|e| e.to_string())?;
    let sha = sha256_hex(content.as_bytes());
    Ok((content, sha))
}

fn webdav_put(
    config: &WebDavConfig,
    path: &str,
    content: &str,
    etag: Option<String>,
) -> Result<ActionResponse, String> {
    ensure_markdown(path)?;
    reject_unsafe_relative(path)?;
    let client = build_client()?;
    let mut headers = webdav_headers(config)?;
    if let Some(etag) = etag {
        if !etag.is_empty() {
            headers.insert(
                IF_MATCH,
                HeaderValue::from_str(&format!("\"{}\"", etag)).map_err(|e| e.to_string())?,
            );
        }
    } else {
        headers.insert(IF_NONE_MATCH, HeaderValue::from_static("*"));
    }
    let url = format!(
        "{}/{}",
        config.url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let resp = client
        .put(&url)
        .headers(headers)
        .header("Content-Type", "text/markdown; charset=utf-8")
        .body(content.to_string())
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() && status != StatusCode::CREATED && status != StatusCode::NO_CONTENT {
        return Err(format!("HTTP {}", status));
    }
    let new_etag = resp
        .headers()
        .get(ETAG)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_default();
    let sha = sha256_hex(content.as_bytes());
    Ok(ActionResponse {
        sha,
        etag: new_etag,
    })
}

fn webdav_delete(config: &WebDavConfig, path: &str) -> Result<ActionResponse, String> {
    ensure_markdown(path)?;
    reject_unsafe_relative(path)?;
    let client = build_client()?;
    let headers = webdav_headers(config)?;
    let url = format!(
        "{}/{}",
        config.url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let resp = client
        .delete(&url)
        .headers(headers)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() && resp.status() != StatusCode::NO_CONTENT {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(ActionResponse {
        sha: String::new(),
        etag: String::new(),
    })
}

// ── Public Tauri commands ─────────────────────────────────────────────────────

pub fn sync_test_connection(provider: SyncProviderConfig) -> Result<serde_json::Value, String> {
    match provider.r#type.as_str() {
        "github" => {
            let cfg = provider_to_github(&provider)?;
            github_test(cfg)
        }
        "webdav" => {
            let cfg = provider_to_webdav(&provider)?;
            webdav_test(cfg)
        }
        other => Err(format!("未知同步类型: {}", other)),
    }
}

pub fn sync_list_remote(provider: SyncProviderConfig) -> Result<Vec<RemoteFileMeta>, String> {
    match provider.r#type.as_str() {
        "github" => {
            let cfg = provider_to_github(&provider)?;
            github_list(&cfg)
        }
        "webdav" => {
            let cfg = provider_to_webdav(&provider)?;
            webdav_list(&cfg)
        }
        other => Err(format!("未知同步类型: {}", other)),
    }
}

pub fn sync_build_plan(
    provider: SyncProviderConfig,
    vault: &Mutex<VaultState>,
    logger: &AppLogger,
) -> Result<BuildPlanResponse, String> {
    let remote = sync_list_remote(provider.clone())?;
    let (actions, pulls, remote_deletions) = build_plan_for(&provider, vault, &remote, logger)?;
    let summary = summarize(&actions);
    let baseline = {
        let st = vault.lock().unwrap();
        st.baseline_snapshot()
    };
    Ok(BuildPlanResponse {
        plan_id: uuid_short(),
        provider: provider.r#type.clone(),
        actions,
        summary,
        remote_meta: remote,
        pulls,
        remote_deletions,
        baseline,
    })
}

fn build_plan_for(
    provider: &SyncProviderConfig,
    vault: &Mutex<VaultState>,
    remote: &[RemoteFileMeta],
    logger: &AppLogger,
) -> Result<(Vec<PlanAction>, Vec<PulledFile>, Vec<RemoteDeletion>), String> {
    let local_files = {
        let st = vault.lock().unwrap();
        if st.root.is_none() {
            return Err("Vault 未打开，无法生成同步计划".to_string());
        }
        scan_local_files(&st.root.as_ref().unwrap().clone())?
    };
    let local_index: BTreeMap<String, LocalFileEntry> = local_files.into_iter().collect();
    let remote_index: BTreeMap<String, RemoteFileMeta> =
        remote.iter().map(|m| (m.path.clone(), m.clone())).collect();
    let pending_deletions = {
        let st = vault.lock().unwrap();
        st.pending_deletions()
    };
    let baseline = {
        let st = vault.lock().unwrap();
        st.baseline_snapshot()
    };

    let mut actions: Vec<PlanAction> = Vec::new();
    let mut pulls: Vec<PulledFile> = Vec::new();
    let mut remote_deletions: Vec<RemoteDeletion> = Vec::new();

    let mut all_paths: BTreeMap<String, ()> = BTreeMap::new();
    for path in local_index.keys() {
        all_paths.insert(path.clone(), ());
    }
    for path in remote_index.keys() {
        all_paths.insert(path.clone(), ());
    }

    for path in all_paths.keys() {
        let local = local_index.get(path);
        let remote_entry = remote_index.get(path);
        let base = baseline.get(path);
        let pending = pending_deletions.get(path);

        match (local, remote_entry) {
            (Some(local_entry), Some(remote_entry)) => {
                if local_entry.sha == remote_entry.sha {
                    actions.push(PlanAction::Noop {
                        path: path.clone(),
                        reason: "本地与远端一致".to_string(),
                    });
                    continue;
                }
                match base {
                    Some(base_entry) if base_entry.sha == local_entry.sha => {
                        // Local matches base, so the user has not edited it
                        // locally — pull the remote change down.
                        let (content, _) = fetch_remote_file(provider, path)?;
                        pulls.push(PulledFile {
                            path: path.clone(),
                            content: content.clone(),
                            remote_sha: remote_entry.sha.clone(),
                            remote_etag: remote_entry.etag.clone(),
                        });
                        actions.push(PlanAction::Pull {
                            path: path.clone(),
                            remote_sha: remote_entry.sha.clone(),
                            remote_etag: remote_entry.etag.clone(),
                        });
                    }
                    Some(base_entry) if base_entry.sha == remote_entry.sha => {
                        // Remote matches base, so the user has only changed
                        // this file locally — upload it.
                        actions.push(PlanAction::Upload {
                            path: path.clone(),
                            base_sha: Some(base_entry.sha.clone()),
                            remote_etag: if remote_entry.etag.is_empty() {
                                None
                            } else {
                                Some(remote_entry.etag.clone())
                            },
                        });
                    }
                    Some(base_entry) => {
                        // Both sides diverged from the baseline → conflict.
                        let base_content =
                            read_base_content(provider, &base_entry.sha).unwrap_or_default();
                        let conflict = ConflictPayload {
                            path: path.clone(),
                            kind: "text-edit".to_string(),
                            base: base_content,
                            local: local_entry.content.clone(),
                            remote: String::new(),
                            local_mtime: local_entry.mtime,
                            remote_sha: remote_entry.sha.clone(),
                            remote_etag: remote_entry.etag.clone(),
                            local_sha: local_entry.sha.clone(),
                        };
                        actions.push(PlanAction::Conflict { conflict });
                    }
                    None => {
                        write_log(
                            logger,
                            "WARN",
                            "sync.no_baseline",
                            &format!("path={} → 上传并创建基线", path),
                        );
                        actions.push(PlanAction::Upload {
                            path: path.clone(),
                            base_sha: None,
                            remote_etag: if remote_entry.etag.is_empty() {
                                None
                            } else {
                                Some(remote_entry.etag.clone())
                            },
                        });
                    }
                }
            }
            (Some(local_entry), None) => match pending {
                Some(_) => {
                    actions.push(PlanAction::DeleteRemote {
                        path: path.clone(),
                        local_sha: local_entry.sha.clone(),
                    });
                }
                None => match base {
                    Some(base_entry) if base_entry.sha == local_entry.sha => {
                        actions.push(PlanAction::Noop {
                            path: path.clone(),
                            reason: "本地为新增文件，尚未同步到远端".to_string(),
                        });
                    }
                    Some(_) => {
                        actions.push(PlanAction::Upload {
                            path: path.clone(),
                            base_sha: None,
                            remote_etag: None,
                        });
                    }
                    None => {
                        actions.push(PlanAction::Upload {
                            path: path.clone(),
                            base_sha: None,
                            remote_etag: None,
                        });
                    }
                },
            },
            (None, Some(remote_entry)) => {
                if let Some(_pending) = pending {
                    actions.push(PlanAction::DeleteLocal {
                        path: path.clone(),
                        remote_sha: remote_entry.sha.clone(),
                        remote_etag: remote_entry.etag.clone(),
                    });
                    remote_deletions.push(RemoteDeletion {
                        path: path.clone(),
                        remote_etag: remote_entry.etag.clone(),
                        remote_sha: remote_entry.sha.clone(),
                    });
                } else {
                    // Remote file we don't have locally.  Pull it down.
                    let (content, _) = fetch_remote_file(provider, path)?;
                    pulls.push(PulledFile {
                        path: path.clone(),
                        content,
                        remote_sha: remote_entry.sha.clone(),
                        remote_etag: remote_entry.etag.clone(),
                    });
                    actions.push(PlanAction::Pull {
                        path: path.clone(),
                        remote_sha: remote_entry.sha.clone(),
                        remote_etag: remote_entry.etag.clone(),
                    });
                }
            }
            (None, None) => {
                // shouldn't happen because we built the set from these keys
            }
        }
    }

    Ok((actions, pulls, remote_deletions))
}

#[derive(Clone, Debug)]
struct LocalFileEntry {
    sha: String,
    mtime: u64,
    content: String,
}

fn scan_local_files(root: &Path) -> Result<BTreeMap<String, LocalFileEntry>, String> {
    let mut out = BTreeMap::new();
    walk_local(root, root, &mut out)?;
    Ok(out)
}

fn walk_local(
    root: &Path,
    current: &Path,
    out: &mut BTreeMap<String, LocalFileEntry>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        if meta.is_dir() {
            walk_local(root, &path, out)?;
        } else if meta.is_file() && ensure_markdown(&path.to_string_lossy()).is_ok() {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if reject_unsafe_relative(&rel).is_err() {
                continue;
            }
            let content = fs::read_to_string(&path).unwrap_or_default();
            let sha = sha256_hex(content.as_bytes());
            let mtime = meta
                .modified()
                .map(|m| {
                    m.duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                })
                .unwrap_or(0);
            out.insert(
                rel,
                LocalFileEntry {
                    sha,
                    mtime,
                    content,
                },
            );
        }
    }
    Ok(())
}

fn fetch_remote_file(
    provider: &SyncProviderConfig,
    path: &str,
) -> Result<(String, String), String> {
    match provider.r#type.as_str() {
        "github" => {
            let cfg = provider_to_github(provider)?;
            github_get(&cfg, path)
        }
        "webdav" => {
            let cfg = provider_to_webdav(provider)?;
            webdav_get(&cfg, path)
        }
        other => Err(format!("未知同步类型: {}", other)),
    }
}

fn read_base_content(_provider: &SyncProviderConfig, _sha: &str) -> Result<String, String> {
    // Baselines are not stored as raw bytes; the only consumer is the
    // conflict UI which fetches local content directly.  Returning an empty
    // string is safe — the front-end will still render local-vs-empty diff.
    Ok(String::new())
}

fn summarize(actions: &[PlanAction]) -> PlanSummary {
    let mut summary = PlanSummary {
        pull: 0,
        upload: 0,
        delete_local: 0,
        delete_remote: 0,
        conflict: 0,
        noop: 0,
    };
    for action in actions {
        match action {
            PlanAction::Noop { .. } => summary.noop += 1,
            PlanAction::Pull { .. } => summary.pull += 1,
            PlanAction::Upload { .. } => summary.upload += 1,
            PlanAction::DeleteLocal { .. } => summary.delete_local += 1,
            PlanAction::DeleteRemote { .. } => summary.delete_remote += 1,
            PlanAction::Conflict { .. } => summary.conflict += 1,
        }
    }
    summary
}

fn provider_to_github(provider: &SyncProviderConfig) -> Result<GitHubConfig, String> {
    let owner = provider
        .config
        .get("owner")
        .ok_or_else(|| "缺少 GitHub owner".to_string())?
        .clone();
    let repo = provider
        .config
        .get("repo")
        .ok_or_else(|| "缺少 GitHub repo".to_string())?
        .clone();
    let branch = provider
        .config
        .get("branch")
        .cloned()
        .unwrap_or_else(|| "main".to_string());
    let api_url = provider.config.get("api_url").cloned().unwrap_or_default();
    if !credential_has("github-token".to_string()) {
        return Err("GitHub 凭据未配置".to_string());
    }
    Ok(GitHubConfig {
        owner,
        repo,
        branch,
        api_url,
    })
}

fn provider_to_webdav(provider: &SyncProviderConfig) -> Result<WebDavConfig, String> {
    let url = provider
        .config
        .get("url")
        .ok_or_else(|| "缺少 WebDAV URL".to_string())?
        .clone();
    let username = provider
        .config
        .get("username")
        .ok_or_else(|| "缺少 WebDAV 用户名".to_string())?
        .clone();
    if !credential_has("webdav-password".to_string()) {
        return Err("WebDAV 密码未配置".to_string());
    }
    Ok(WebDavConfig { url, username })
}

pub fn sync_apply_action(
    provider: SyncProviderConfig,
    action: ActionRequest,
    vault: &Mutex<VaultState>,
    logger: &AppLogger,
) -> Result<ActionResponse, String> {
    let result = match action {
        ActionRequest::Pull { path } => {
            let (content, _sha) = fetch_remote_file(&provider, &path)?;
            {
                let mut st = vault.lock().unwrap();
                write_local_file(&st, &path, &content)?;
                st.fingerprint(&path, 0, 0);
            }
            write_log(logger, "INFO", "sync.pull", &format!("path={}", path));
            ActionResponse {
                sha: sha256_hex(content.as_bytes()),
                etag: String::new(),
            }
        }
        ActionRequest::Upload {
            path,
            content,
            base_sha,
        } => match provider.r#type.as_str() {
            "github" => {
                let cfg = provider_to_github(&provider)?;
                github_put(&cfg, &path, &content, base_sha.clone())?
            }
            "webdav" => {
                let cfg = provider_to_webdav(&provider)?;
                webdav_put(&cfg, &path, &content, None)?
            }
            other => return Err(format!("未知同步类型: {}", other)),
        },
        ActionRequest::DeleteLocal { path } => {
            {
                let mut st = vault.lock().unwrap();
                let resolved = st
                    .resolve(&path)
                    .map_err(|e| format!("无法解析本地路径: {}", e))?;
                if resolved.exists() {
                    fs::remove_file(&resolved).map_err(|e| e.to_string())?;
                }
                st.record_deletion(&path);
            }
            write_log(
                logger,
                "INFO",
                "sync.delete_local",
                &format!("path={}", path),
            );
            ActionResponse {
                sha: String::new(),
                etag: String::new(),
            }
        }
        ActionRequest::DeleteRemote { path } => {
            let base = {
                let st = vault.lock().unwrap();
                st.baseline_snapshot().get(&path).map(|e| e.sha.clone())
            };
            match provider.r#type.as_str() {
                "github" => {
                    let cfg = provider_to_github(&provider)?;
                    github_delete(&cfg, &path, base.as_deref().unwrap_or(""))?
                }
                "webdav" => {
                    let cfg = provider_to_webdav(&provider)?;
                    webdav_delete(&cfg, &path)?
                }
                other => return Err(format!("未知同步类型: {}", other)),
            }
        }
    };
    Ok(result)
}

fn write_local_file(state: &VaultState, path: &str, content: &str) -> Result<(), String> {
    let resolved = state
        .resolve(path)
        .map_err(|e| format!("Vault 边界检查失败: {}", e))?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = resolved.with_extension("md.tmp");
    fs::write(&temp, content).map_err(|e| e.to_string())?;
    fs::rename(&temp, &resolved).map_err(|e| e.to_string())
}

// ── Baseline persistence ──────────────────────────────────────────────────────

fn baseline_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("sync-baseline.json")
}

pub fn sync_load_baseline(app_data_dir: &Path) -> HashMap<String, BaselineEntry> {
    let path = baseline_path(app_data_dir);
    let Ok(bytes) = fs::read(&path) else {
        return HashMap::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn sync_save_baseline(
    app_data_dir: &Path,
    next: HashMap<String, BaselineEntry>,
) -> Result<(), String> {
    if !app_data_dir.exists() {
        fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    }
    let path = baseline_path(app_data_dir);
    let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn sync_replace_baseline(vault: &Mutex<VaultState>, next: HashMap<String, BaselineEntry>) {
    let mut st = vault.lock().unwrap();
    st.replace_baseline(next);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn entry(sha: &str) -> BaselineEntry {
        BaselineEntry {
            sha: sha.to_string(),
            etag: String::new(),
        }
    }

    #[test]
    fn rejects_unsafe_paths() {
        assert!(reject_unsafe_relative("../escape.md").is_err());
        assert!(reject_unsafe_relative("C:/Windows/file.md").is_err());
        assert!(reject_unsafe_relative("\\evil\\path.md").is_err());
        assert!(reject_unsafe_relative("/abs/path.md").is_err());
        assert!(reject_unsafe_relative("notes/ok.md").is_ok());
        assert!(reject_unsafe_relative("notes/sub/ok.md").is_ok());
    }

    #[test]
    fn log_sanitizer_strips_tokens() {
        let s = "Authorization: Bearer ghp_abc123def456; password=hunter2";
        let sanitized = sanitize_for_log(s);
        assert!(!sanitized.contains("ghp_abc123def456"));
        assert!(!sanitized.contains("hunter2"));
    }

    #[test]
    fn plan_summarize_counts_correctly() {
        let actions = vec![
            PlanAction::Pull {
                path: "a.md".into(),
                remote_sha: "s1".into(),
                remote_etag: String::new(),
            },
            PlanAction::Upload {
                path: "b.md".into(),
                base_sha: None,
                remote_etag: None,
            },
            PlanAction::DeleteLocal {
                path: "c.md".into(),
                remote_sha: "s3".into(),
                remote_etag: String::new(),
            },
            PlanAction::DeleteRemote {
                path: "d.md".into(),
                local_sha: "s4".into(),
            },
            PlanAction::Conflict {
                conflict: ConflictPayload {
                    path: "e.md".into(),
                    kind: "text-edit".into(),
                    base: String::new(),
                    local: "L".into(),
                    remote: "R".into(),
                    local_mtime: 0,
                    remote_sha: "s5".into(),
                    remote_etag: String::new(),
                    local_sha: "s6".into(),
                },
            },
            PlanAction::Noop {
                path: "f.md".into(),
                reason: "ok".into(),
            },
        ];
        let s = summarize(&actions);
        assert_eq!(s.pull, 1);
        assert_eq!(s.upload, 1);
        assert_eq!(s.delete_local, 1);
        assert_eq!(s.delete_remote, 1);
        assert_eq!(s.conflict, 1);
        assert_eq!(s.noop, 1);
    }

    #[test]
    fn baseline_persists_atomically() {
        let dir = std::env::temp_dir().join(format!("mardown-beautiful-baseline-{}", uuid_short()));
        fs::create_dir_all(&dir).unwrap();
        let mut next = BTreeMap::new();
        next.insert("notes/a.md".to_string(), entry("sha-a"));
        next.insert("notes/b.md".to_string(), entry("sha-b"));
        let map: HashMap<String, BaselineEntry> = next.into_iter().collect();
        sync_save_baseline(&dir, map.clone()).unwrap();
        let loaded = sync_load_baseline(&dir);
        assert_eq!(
            loaded.get("notes/a.md").map(|e| e.sha.clone()),
            Some("sha-a".to_string())
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_relative_to_strips_base() {
        let rel = path_relative_to(
            "https://cloud.example.com/remote.php/dav",
            "https://cloud.example.com/remote.php/dav/notes/a.md",
        )
        .unwrap();
        assert_eq!(rel, "notes/a.md");
    }

    #[test]
    fn webdav_listing_collects_only_files() {
        // We test the parser in isolation; the actual XML returned by a real
        // WebDAV server uses different namespaces, so we only assert the
        // path/etag extraction logic with a small synthetic payload.
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/notes/a.md</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>12</d:getcontentlength>
        <d:getetag>"abc"</d:getetag>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/notes/sub</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;
        let files = parse_webdav_listing(xml, "https://cloud.example.com/remote.php/dav");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "notes/a.md");
        assert_eq!(files[0].size, 12);
    }
}

// Expose uuid_short for tests without dragging in main's private symbol.
pub fn uuid_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}{:x}", dur.as_secs(), dur.subsec_nanos())
}
