// Export service (Phase 5) — converts the current document to other formats.
//
// Always available: HTML (sanitized body from the preview pipeline) and TXT.
// Pandoc-backed formats (docx/odt/latex/rst/mediawiki/epub/pdf) require the
// `pandoc` CLI on the host; when it is missing the report says so instead of
// silently producing a broken file.  Exports write through a temp file and
// only rename on success, so a failed export never overwrites an existing
// target.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::uuid_short;

#[derive(Serialize, Clone, Debug)]
pub struct ExportReport {
    pub ok: bool,
    pub format: String,
    pub target_path: String,
    pub size: u64,
    pub engine: String,
    pub warnings: Vec<String>,
    pub missing_resources: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub const FALLBACK_FORMATS: [&str; 2] = ["html", "txt"];

/// Returns the pandoc version string when the CLI is available.
pub fn detect_pandoc() -> Option<String> {
    let output = Command::new("pandoc").arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    Some(first_line)
}

fn pandoc_target_format(format: &str) -> Result<&str, String> {
    Ok(match format {
        "docx" => "docx",
        "odt" => "odt",
        "latex" => "latex",
        "rst" => "rst",
        "mediawiki" => "mediawiki",
        "epub" => "epub3",
        "pdf" => "pdf",
        other => return Err(format!("不支持的 Pandoc 导出格式: {}", other)),
    })
}

fn requires_pandoc(format: &str) -> bool {
    !FALLBACK_FORMATS.contains(&format)
}

fn default_css() -> &'static str {
    "body{margin:2.5rem auto;max-width:46rem;font:16px/1.6 -apple-system,'Segoe UI',sans-serif;color:#222;}
h1,h2,h3{line-height:1.25;} code,pre{font-family:Menlo,Consolas,monospace;font-size:.9em;}
pre{padding:.8em;background:#f6f6f6;border-radius:6px;overflow:auto;}
blockquote{border-left:4px solid #ddd;margin:0;padding-left:1em;color:#555;}
table{border-collapse:collapse;} th,td{border:1px solid #ccc;padding:4px 10px;}
img{max-width:100%;} .math-error{color:#c0392b;}"
}

/// Escape the pieces we interpolate into the HTML template.
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Minimal markdown → plain text for TXT export (no regex dependency).
pub fn markdown_to_plain_text(markdown: &str) -> String {
    let mut out_lines: Vec<String> = Vec::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            out_lines.push(line.to_string());
            continue;
        }
        let mut out = String::new();
        let mut chars = line.chars().peekable();
        while let Some(ch) = chars.next() {
            match ch {
                '*' | '_' | '`' | '#' => {}
                '!' => {
                    // ![alt](src) → alt
                    if chars.peek() == Some(&'[') {
                        chars.next();
                        let mut alt = String::new();
                        for c in chars.by_ref() {
                            if c == ']' {
                                break;
                            }
                            alt.push(c);
                        }
                        // swallow (src)
                        if chars.peek() == Some(&'(') {
                            for c in chars.by_ref() {
                                if c == ')' {
                                    break;
                                }
                            }
                        }
                        out.push_str(&alt);
                    } else {
                        out.push(ch);
                    }
                }
                '[' => {
                    let mut label = String::new();
                    let mut closed = false;
                    for c in chars.by_ref() {
                        if c == ']' {
                            closed = true;
                            break;
                        }
                        label.push(c);
                    }
                    if closed && chars.peek() == Some(&'(') {
                        for c in chars.by_ref() {
                            if c == ')' {
                                break;
                            }
                        }
                    }
                    out.push_str(&label);
                }
                _ => out.push(ch),
            }
        }
        out_lines.push(out.trim_end().to_string());
    }
    out_lines.join("\n")
}

fn html_document(title: &str, body_html: &str, user_css: Option<&str>) -> String {
    let user_css = user_css.unwrap_or("");
    // Guard against a user stylesheet closing the tag early.
    let user_css = user_css.replace("</style", "<\\/style");
    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<title>{}</title>\n<style>\n{}</style>\n<style>\n{}</style>\n</head>\n<body>\n<article>\n{}</article>\n</body>\n</html>\n",
        escape_html(title),
        default_css(),
        user_css,
        body_html
    )
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = target.parent().ok_or("无效的目标路径")?;
    let temp = dir.join(format!(".{}.tmp", uuid_short()));
    let result = (|| {
        fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        fs::rename(&temp, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn run_pandoc(
    source_md: &Path,
    target: &Path,
    format: &str,
    title: &str,
) -> Result<String, String> {
    let to = pandoc_target_format(format)?;
    let from = "gfm+tex_math_dollars+tex_math_single_backslash+tex_math_double_backslash+footnotes";
    let mut cmd = Command::new("pandoc");
    cmd.arg("--from")
        .arg(from)
        .arg("--to")
        .arg(to)
        .arg("--output")
        .arg(target)
        .arg("--metadata")
        .arg(format!("title={}", title))
        .arg(source_md);
    let output = cmd
        .output()
        .map_err(|e| format!("无法启动 pandoc: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let hint = if format == "pdf" {
            "（PDF 需要 LaTeX 引擎，如 BasicTeX/MiKTeX；也可改用“打印为 PDF”）"
        } else {
            ""
        };
        return Err(format!("pandoc 导出失败: {} {}", stderr.trim(), hint));
    }
    Ok("pandoc".to_string())
}

/// Execute one export.  `body_html` is only used for the HTML format and is
/// expected to come from the sanitized preview pipeline.
pub fn export_document(
    format: &str,
    title: &str,
    markdown: &str,
    body_html: Option<&str>,
    user_css: Option<&str>,
    target: &Path,
    missing_resources: Vec<String>,
    extra_warnings: Vec<String>,
) -> Result<ExportReport, String> {
    let mut warnings: Vec<String> = extra_warnings;
    if !missing_resources.is_empty() {
        // 缺失资源时不静默生成残缺文件。
        return Err(format!(
            "以下资源缺失，已取消导出：{}",
            missing_resources.join(", ")
        ));
    }
    if target.exists() {
        warnings.push("目标文件已存在，成功后将覆盖。".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let engine: String;
    if format == "html" {
        let body = body_html.ok_or("HTML 导出需要预览渲染结果")?;
        engine = "app-html".to_string();
        atomic_write(target, html_document(title, body, user_css).as_bytes())?;
    } else if format == "txt" {
        engine = "app-txt".to_string();
        atomic_write(target, markdown_to_plain_text(markdown).as_bytes())?;
    } else if requires_pandoc(format) {
        let pandoc = detect_pandoc().ok_or_else(|| {
            format!(
                "未检测到 pandoc CLI；{} 格式需要 pandoc。可先导出 HTML 或 TXT。",
                format
            )
        })?;
        let _ = pandoc;
        let temp_md = target
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!(".{}.md", uuid_short()));
        fs::write(&temp_md, markdown).map_err(|e| e.to_string())?;
        let result = run_pandoc(&temp_md, target, format, title);
        let _ = fs::remove_file(&temp_md);
        result?;
        engine = "pandoc".to_string();
    } else {
        return Err(format!("不支持的导出格式: {}", format));
    }

    let size = fs::metadata(target).map(|m| m.len()).unwrap_or(0);
    Ok(ExportReport {
        ok: true,
        format: format.to_string(),
        target_path: target.to_string_lossy().to_string(),
        size,
        engine,
        warnings,
        missing_resources,
        error: None,
    })
}

/// Absolute-path builder shared with the Tauri command layer.
pub fn target_path(dir: &Path, file_name: &str) -> PathBuf {
    dir.join(file_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_export_writes_standalone_document() {
        let dir = std::env::temp_dir().join(format!("mdapp-export-{}", uuid_short()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.html");
        let report = export_document(
            "html",
            "T <1>",
            "# x",
            Some("<h1>x</h1>"),
            None,
            &target,
            vec![],
            vec![],
        )
        .unwrap();
        assert!(report.ok);
        let html = fs::read_to_string(&target).unwrap();
        assert!(html.contains("<title>T &lt;1&gt;</title>"));
        assert!(html.contains("<h1>x</h1>"));
        assert!(html.contains("max-width:46rem"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn user_css_is_embedded_and_neutralized_for_tag_escape() {
        let doc = html_document("t", "<p>x</p>", Some("p{color:red}</style><script>"));
        assert!(doc.contains("p{color:red}<\\/style>"));
        assert!(!doc.contains("</style><script>"));
    }

    #[test]
    fn txt_export_strips_markdown() {
        let md = "# 标题\n\n这是 **加粗** 与 [链接](https://x.y)。\n\n```code\nkeep me\n```\n";
        let text = markdown_to_plain_text(md);
        assert!(text.contains("标题"));
        assert!(text.contains("这是 加粗 与 链接。"));
        assert!(text.contains("keep me"));
        assert!(!text.contains('#'));
        assert!(!text.contains("**"));
    }

    #[test]
    fn pandoc_format_without_pandoc_fails_cleanly_and_keeps_target() {
        if detect_pandoc().is_some() {
            return; // pandoc installed — failure path can't be exercised here
        }
        let dir = std::env::temp_dir().join(format!("mdapp-export-{}", uuid_short()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.docx");
        fs::write(&target, b"existing").unwrap();
        let err =
            export_document("docx", "t", "md", None, None, &target, vec![], vec![]).unwrap_err();
        assert!(err.contains("未检测到 pandoc"), "unexpected: {}", err);
        assert_eq!(fs::read(&target).unwrap(), b"existing");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_resources_abort_export() {
        let dir = std::env::temp_dir().join(format!("mdapp-export-{}", uuid_short()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.html");
        let err = export_document(
            "html",
            "t",
            "md",
            Some("<p>x</p>"),
            None,
            &target,
            vec!["assets/gone.png".to_string()],
            vec![],
        )
        .unwrap_err();
        assert!(err.contains("资源缺失"));
        assert!(!target.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
