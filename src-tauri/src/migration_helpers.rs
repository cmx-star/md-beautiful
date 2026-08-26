//! Migration helpers — pure-data Rust counterparts of the TypeScript
//! `migrationService` / `slugify` / `frontmatter` modules.
//!
//! These functions are intentionally filesystem-agnostic where possible so
//! the safety contract (no `..`, no absolute paths, no Windows reserved
//! names, roundtrip-safe YAML) can be exercised in unit tests without the
//! Tauri runtime.

use std::fs;
use std::path::{Path, PathBuf};

const FORBIDDEN: &[char] = &['/', '\\', '\0'];
const MAX_LENGTH: usize = 60;

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Slugify a note title.  Returns `None` for inputs that contain `..`
/// components, absolute paths, or that resolve to empty/whitespace after
/// sanitization.  Reserved device names are prefixed with `note-`.
pub fn slugify_title(title: &str) -> Option<String> {
    if title.is_empty() {
        return None;
    }
    // Reject `..` and absolute path-looking inputs up-front.  `..` and `/`
    // are forbidden characters so the simple `FORBIDDEN` check covers them.
    if title.contains("..") {
        return None;
    }
    if title.starts_with('/') || title.starts_with('\\') {
        return None;
    }

    let mut buffer = String::with_capacity(title.len());
    let mut last_was_sep = true;
    for character in title.chars() {
        if FORBIDDEN.contains(&character) {
            if !last_was_sep {
                buffer.push('-');
                last_was_sep = true;
            }
            continue;
        }
        if character.is_whitespace() {
            if !last_was_sep {
                buffer.push('-');
                last_was_sep = true;
            }
            continue;
        }
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            buffer.push(character);
            last_was_sep = false;
        }
        // Non-ASCII is silently dropped, matching the TS implementation.
    }

    while buffer.ends_with('-') || buffer.ends_with('.') {
        buffer.pop();
    }

    if buffer.is_empty() {
        return None;
    }
    if buffer.len() > MAX_LENGTH {
        buffer.truncate(MAX_LENGTH);
        while buffer.ends_with('-') || buffer.ends_with('.') {
            buffer.pop();
        }
        if buffer.is_empty() {
            return None;
        }
    }
    if RESERVED
        .iter()
        .any(|name| name.eq_ignore_ascii_case(&buffer))
    {
        return Some(format!("note-{}", buffer));
    }
    Some(buffer)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontmatterDoc {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub folder_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub word_count: u64,
    pub is_favorite: bool,
}

fn escape_scalar(value: &str) -> String {
    let needs_quote = value.is_empty()
        || value.contains(':')
        || value.contains('#')
        || value.contains('&')
        || value.contains('*')
        || value.contains('!')
        || value.contains('|')
        || value.contains('>')
        || value.contains('\'')
        || value.contains('"')
        || value.contains('%')
        || value.contains('@')
        || value.contains('`')
        || value.contains('{')
        || value.contains('}')
        || value.contains('[')
        || value.contains(']')
        || value.contains(',')
        || value.contains('\n')
        || value.starts_with(char::is_whitespace)
        || value.ends_with(char::is_whitespace);
    if needs_quote {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{}\"", escaped)
    } else {
        value.to_string()
    }
}

/// Serialize a `FrontmatterDoc` to YAML frontmatter.  Field order matches
/// the TypeScript implementation: id, title, tags, folder_id (omitted when
/// `None`), created_at, updated_at, word_count, is_favorite.
pub fn serialize_frontmatter(doc: &FrontmatterDoc) -> String {
    let mut lines = Vec::with_capacity(10);
    lines.push("---".to_string());
    lines.push(format!("id: {}", escape_scalar(&doc.id)));
    lines.push(format!("title: {}", escape_scalar(&doc.title)));
    let tags = doc
        .tags
        .iter()
        .map(|t| escape_scalar(t))
        .collect::<Vec<_>>()
        .join(", ");
    lines.push(format!("tags: [{}]", tags));
    if let Some(folder) = &doc.folder_id {
        lines.push(format!("folder_id: {}", escape_scalar(folder)));
    }
    lines.push(format!("created_at: {}", doc.created_at));
    lines.push(format!("updated_at: {}", doc.updated_at));
    lines.push(format!("word_count: {}", doc.word_count));
    lines.push(format!("is_favorite: {}", doc.is_favorite));
    lines.push("---".to_string());
    lines.join("\n")
}

/// Parse the YAML frontmatter produced by `serialize_frontmatter`.  Returns
/// `None` for malformed input.  Supports the same scalar shapes as the
/// serializer (strings, numbers, booleans, comma lists, quoted strings).
pub fn parse_frontmatter(raw: &str) -> Option<FrontmatterDoc> {
    let trimmed = raw.strip_prefix("---")?;
    let rest = trimmed
        .strip_prefix('\n')
        .or_else(|| trimmed.strip_prefix("\r\n"))?;
    let end = rest.find("\n---")?;
    let block = &rest[..end];

    let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in block.split('\n') {
        let line = line.trim_end();
        if line.trim().is_empty() || line.trim().starts_with('#') {
            continue;
        }
        let (key, value) = line.split_once(':')?;
        fields.insert(key.trim().to_string(), value.trim().to_string());
    }

    let id = fields.get("id")?.clone();
    let title = fields.get("title")?.clone();
    let created_at = fields.get("created_at")?.parse::<u64>().ok()?;
    let updated_at = fields.get("updated_at")?.parse::<u64>().ok()?;
    let word_count = fields.get("word_count")?.parse::<u64>().ok()?;
    let is_favorite = match fields.get("is_favorite")?.as_str() {
        "true" => true,
        "false" => false,
        _ => return None,
    };

    let tags_raw = fields.get("tags")?.clone();
    let tags = if let Some(stripped) = tags_raw.strip_prefix('[').and_then(|s| s.strip_suffix(']'))
    {
        split_quoted_csv(stripped)
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        Vec::new()
    };
    let folder_id = fields.get("folder_id").cloned();

    Some(FrontmatterDoc {
        id,
        title,
        tags,
        folder_id,
        created_at,
        updated_at,
        word_count,
        is_favorite,
    })
}

/// Snapshot payload format written to `.migration-backup-<iso>.json`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MigrationSnapshot {
    pub schema_version: u32,
    pub captured_at: u64,
    pub notes: serde_json::Value,
}

const SNAPSHOT_PREFIX: &str = ".migration-backup-";
const SNAPSHOT_SUFFIX: &str = ".json";

pub fn snapshot_file_name(now_iso: &str) -> String {
    // Mirror the TS implementation: replace `:` and `.` with `-` for
    // filesystem safety.
    let safe = now_iso.replace([':', '.'], "-");
    format!("{}{}{}", SNAPSHOT_PREFIX, safe, SNAPSHOT_SUFFIX)
}

pub fn revert_dir_name(now_iso: &str) -> String {
    let safe = now_iso.replace([':', '.'], "-");
    format!(".reverted-{}", safe)
}

/// Write a JSON snapshot file inside `vault_root`, returning the relative
/// path.  The caller is responsible for ensuring the vault root is open
/// and writable.
pub fn write_snapshot(
    vault_root: &Path,
    now_iso: &str,
    payload: &MigrationSnapshot,
) -> Result<String, String> {
    let relative = snapshot_file_name(now_iso);
    let full = vault_root.join(&relative);
    let body = serde_json::to_string_pretty(payload).map_err(|e| e.to_string())?;
    atomic_write_file(&full, &body)?;
    Ok(relative)
}

/// Read a snapshot file by relative path.  Returns an error when the file
/// is missing or malformed.
pub fn read_snapshot(vault_root: &Path, relative_path: &str) -> Result<MigrationSnapshot, String> {
    if relative_path.is_empty() {
        return Err("快照路径不能为空".to_string());
    }
    let normalized = normalize_relative(relative_path)?;
    let full = vault_root.join(&normalized);
    if !full.exists() {
        return Err(format!("快照不存在: {}", normalized));
    }
    let raw = fs::read_to_string(&full).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("快照 JSON 不合法: {}", e))
}

/// Move every regular file directly under `<vault_root>/imported/` to
/// `<vault_root>/imported/<revert_dir>/`, skipping any prior revert
/// subdirectories.  Returns the number of files moved.
pub fn move_imported_to_reverted(vault_root: &Path, revert_dir: &str) -> Result<usize, String> {
    let imported = vault_root.join("imported");
    if !imported.is_dir() {
        return Ok(0);
    }
    let target = imported.join(revert_dir);
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let mut moved = 0usize;
    for entry in fs::read_dir(&imported).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        if name_str.starts_with(".reverted-") {
            continue;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let dest = target.join(&name);
        fs::rename(&path, &dest).map_err(|e| e.to_string())?;
        moved += 1;
    }
    Ok(moved)
}

fn normalize_relative(path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let p = Path::new(path);
    if p.is_absolute() {
        return Err("不允许绝对路径".to_string());
    }
    for component in p.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("不允许访问 Vault 外的文件".to_string());
        }
    }
    Ok(path.replace('\\', "/"))
}

fn atomic_write_file(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("无效路径")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".{}.tmp", tmp_token()));
    let result = (|| -> Result<(), String> {
        fs::write(&temp, content).map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn tmp_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos & 0xffffffff)
}

/// Split a comma-separated list while respecting double-quoted strings.
/// Whitespace around each item is trimmed; surrounding quotes (and the
/// escape sequences `\"` and `\\`) are unescaped.
fn split_quoted_csv(input: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escape = false;
    for character in input.chars() {
        if escape {
            current.push(character);
            escape = false;
            continue;
        }
        if character == '\\' && in_quotes {
            current.push(character);
            escape = true;
            continue;
        }
        if character == '"' {
            in_quotes = !in_quotes;
            continue;
        }
        if character == ',' && !in_quotes {
            items.push(current.trim().to_string());
            current.clear();
            continue;
        }
        current.push(character);
    }
    items.push(current.trim().to_string());
    items.into_iter().filter(|s| !s.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markdown-beautiful-migration-{}-{}-{}",
            label,
            std::process::id(),
            tmp_token()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migration_slug_rejects_parent_dir() {
        assert_eq!(slugify_title("../escape"), None);
        assert_eq!(slugify_title("good/../bad"), None);
        assert_eq!(slugify_title("/absolute"), None);
    }

    #[test]
    fn migration_slug_accepts_safe_input() {
        assert_eq!(slugify_title("My Note 1"), Some("My-Note-1".to_string()));
        assert_eq!(slugify_title(""), None);
        assert_eq!(slugify_title("   "), None);
        // Reserved name gets a `note-` prefix.
        assert_eq!(slugify_title("CON"), Some("note-CON".to_string()));
    }

    #[test]
    fn migration_frontmatter_roundtrip() {
        let doc = FrontmatterDoc {
            id: "abc-123".to_string(),
            title: "Hello world".to_string(),
            tags: vec!["alpha".to_string(), "beta".to_string()],
            folder_id: Some("folder-1".to_string()),
            created_at: 1700000000000,
            updated_at: 1700000001000,
            word_count: 42,
            is_favorite: true,
        };
        let serialized = serialize_frontmatter(&doc);
        let body = "\n# Heading\n\nBody text.\n";
        let file = format!("{}\n{}", serialized, body);

        let parsed = parse_frontmatter(&file).expect("frontmatter should parse");
        assert_eq!(parsed.id, doc.id);
        assert_eq!(parsed.title, doc.title);
        assert_eq!(parsed.tags, doc.tags);
        assert_eq!(parsed.folder_id, doc.folder_id);
        assert_eq!(parsed.created_at, doc.created_at);
        assert_eq!(parsed.updated_at, doc.updated_at);
        assert_eq!(parsed.word_count, doc.word_count);
        assert_eq!(parsed.is_favorite, doc.is_favorite);
    }

    #[test]
    fn migration_frontmatter_omits_null_folder() {
        let doc = FrontmatterDoc {
            id: "x".to_string(),
            title: "no folder".to_string(),
            tags: vec![],
            folder_id: None,
            created_at: 1,
            updated_at: 1,
            word_count: 0,
            is_favorite: false,
        };
        let serialized = serialize_frontmatter(&doc);
        assert!(!serialized.contains("folder_id"));
    }

    #[test]
    fn migration_snapshot_write_and_read() {
        let dir = tmp_dir("snapshot");
        let payload = MigrationSnapshot {
            schema_version: 1,
            captured_at: 12345,
            notes: serde_json::json!([{"id": "n1", "title": "one"}]),
        };
        let relative = write_snapshot(&dir, "2026-08-26T01:02:03.004Z", &payload).unwrap();
        assert!(relative.starts_with(SNAPSHOT_PREFIX));
        assert!(relative.ends_with(SNAPSHOT_SUFFIX));
        assert!(!relative.contains(':'));
        assert!(!relative.contains('.') || relative.ends_with(SNAPSHOT_SUFFIX));

        let read_back = read_snapshot(&dir, &relative).unwrap();
        assert_eq!(read_back.schema_version, 1);
        assert_eq!(read_back.captured_at, 12345);
        assert_eq!(read_back.notes, payload.notes);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn migration_rollback_moves_files() {
        let dir = tmp_dir("rollback");
        let imported = dir.join("imported");
        fs::create_dir_all(&imported).unwrap();
        fs::write(imported.join("first.md"), "# first").unwrap();
        fs::write(imported.join("second.md"), "# second").unwrap();
        // Prior revert dir should be ignored.
        let prior = imported.join(".reverted-prior");
        fs::create_dir_all(&prior).unwrap();
        fs::write(prior.join("old.md"), "old").unwrap();

        let moved = move_imported_to_reverted(&dir, ".reverted-2026-08-26T05-00-00-000Z").unwrap();
        assert_eq!(moved, 2);

        let revert = imported.join(".reverted-2026-08-26T05-00-00-000Z");
        assert!(revert.is_dir());
        assert!(revert.join("first.md").is_file());
        assert!(revert.join("second.md").is_file());
        assert!(!imported.join("first.md").exists());
        // The prior revert dir is untouched.
        assert!(prior.join("old.md").is_file());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn migration_rollback_fails_on_missing_snapshot() {
        let dir = tmp_dir("missing");
        let err = read_snapshot(&dir, ".migration-backup-nope.json").unwrap_err();
        assert!(err.contains("快照不存在"), "unexpected error: {}", err);
        fs::remove_dir_all(&dir).unwrap();
    }
}
