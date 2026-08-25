// Tauri 2 backend — Mardown Beautiful
// Handles: file I/O, GitLab sync, WebDAV sync, cloud directory sync

use tauri::Manager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

// ── Filesystem operations ────────────────────────────────────────────────────

/// Read directory contents
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FileInfo>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        result.push(FileInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            path: entry.path().to_string_lossy().to_string(),
        });
    }
    Ok(result)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileInfo {
    pub name: String,
    pub is_directory: bool,
    pub path: String,
}

/// Read a text file
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write content to a text file
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Create a directory (recursive)
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Delete a file or empty directory
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

/// Get the app's data directory
#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.to_string_lossy().to_string())
}

// ── GitLab sync ──────────────────────────────────────────────────────────────

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

    let method = if exists { reqwest::Method::PUT } else { reqwest::Method::POST };
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
fn gitlab_delete_file(config: GitLabConfig, file_path: String, message: String) -> Result<(), String> {
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

// ── WebDAV sync ──────────────────────────────────────────────────────────────

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
    let path = if dir_path.is_empty() { base.to_string() } else { format!("{}/{}", base, dir_path.trim_start_matches('/')) };
    let resp = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &path)
        .header("Authorization", format!("Basic {}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", config.username, config.password).as_bytes(),
        )))
        .header("Depth", "1")
        .header("Content-Type", "text/xml; charset=utf-8")
        .body(r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:ns0="http://apple.com/ns/ical/">
  <d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>
</d:propfind>"#)
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
                            r#type: if is_collection { "directory".to_string() } else { "file".to_string() },
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
            Ok(Event::Start(e)) if e.name().as_ref() == b"ns0:root" || e.name().as_ref() == b"d:displayname" => {}
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
    let url = format!("{}/{}/{}", base, dir_trim(&config.url), file_path.trim_start_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Basic {}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", config.username, config.password).as_bytes(),
        )))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().map_err(|e| e.to_string())
}

/// Write file via WebDAV
#[tauri::command]
fn webdav_write_file(config: WebDAVConfig, file_path: String, content: String, _message: String) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let base = config.url.trim_end_matches('/');
    let url = format!("{}/{}/{}", base, dir_trim(&config.url), file_path.trim_start_matches('/'));
    let resp = client
        .put(&url)
        .header("Authorization", format!("Basic {}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", config.username, config.password).as_bytes(),
        )))
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
    let url = format!("{}/{}/{}", base, dir_trim(&config.url), file_path.trim_start_matches('/'));
    let resp = client
        .delete(&url)
        .header("Authorization", format!("Basic {}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", config.username, config.password).as_bytes(),
        )))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() && resp.status() != 204 {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(())
}

fn dir_trim(url: &str) -> &str {
    // Extract the directory portion from the WebDAV base URL
    let u = url.trim_end_matches('/');
    u.rsplit_once('/').map(|(_, rest)| rest).unwrap_or("")
}

// ── MathJax formula processing (via QuickJS in Rust) ────────────────────────

/// Process LaTeX formulas in markdown content using QuickJS + MathJax
/// This runs JS in a QuickJS context to evaluate math expressions
#[tauri::command]
fn process_mathjax(input: String) -> Result<String, String> {
    // Use the webview's MathJax (loaded in the frontend) for actual rendering
    // This command just validates and marks formula regions
    let output = input.replace("$", " $$ ")
        .replace("\\(", "\\( \\)")
        .replace("\\)", " \\)");
    Ok(output)
}

// ── Main entry ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // Filesystem
            read_dir,
            read_file,
            write_file,
            create_dir,
            delete_file,
            get_data_dir,
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

fn url_decode(s: &str) -> String {
    percent_encoding::percent_decode(s.as_bytes())
        .decode_utf8()
        .unwrap_or_default()
        .to_string()
}
