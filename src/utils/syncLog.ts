/**
 * Sync log sanitizer — strips credentials, authorization headers and full
 * document bodies from any string before it is appended to the user-visible
 * sync log.  Mirrors the Rust-side `sanitize_log_field` rules.
 */

const TOKEN_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{8,}/g,
  /glpat-[A-Za-z0-9_-]{6,}/g,
  /x-access-token:[^\s,;]+/gi,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /Basic\s+[A-Za-z0-9+/=]{6,}/gi,
  /Authorization:\s*[^\s,;]+/gi,
  /PRIVATE-TOKEN:\s*[^\s,;]+/gi,
  /password\s*[:=]\s*[^\s,;]+/gi,
  /passwd\s*[:=]\s*[^\s,;]+/gi,
  /token\s*[:=]\s*[^\s,;]+/gi,
];

const MAX_BODY_CHARS = 240;
const MAX_FIELD_CHARS = 1024;

function redact(value: string): string {
  let next = value;
  for (const pattern of TOKEN_PATTERNS) {
    next = next.replace(pattern, '[redacted]');
  }
  return next;
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

export function sanitizeSyncLog(message: string): string {
  if (!message) return '';
  const redacted = redact(message);
  return clamp(redacted, MAX_FIELD_CHARS);
}

export function sanitizeSyncBody(body: string): string {
  if (!body) return '';
  return clamp(body.replace(/\s+/g, ' ').trim(), MAX_BODY_CHARS);
}

export function sanitizeSyncField(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return `${name}=<empty>`;
  return `${name}=${sanitizeSyncLog(String(value))}`;
}
