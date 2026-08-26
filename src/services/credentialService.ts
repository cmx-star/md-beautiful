/**
 * Credential service — wraps Tauri IPC commands that read/write secrets in the
 * system Keychain via the Rust `keyring` crate.
 *
 * Front-end never sees the actual secret: the back-end returns a boolean
 * `hasCredential` instead of the plaintext value.
 */

import { invoke } from '@tauri-apps/api/core';

export type CredentialKey = 'github-token' | 'webdav-password';

export const credentialService = {
  /** Persist a secret. Replaces any existing value for the same key. */
  async set(key: CredentialKey, value: string): Promise<void> {
    if (!value) throw new Error('凭据不能为空');
    await invoke<void>('credential_set', { key, value });
  },
  /** Returns true if a secret is stored, false otherwise. Never returns the value itself. */
  async has(key: CredentialKey): Promise<boolean> {
    return invoke<boolean>('credential_has', { key });
  },
  /** Permanently delete the stored secret. Idempotent. */
  async clear(key: CredentialKey): Promise<void> {
    await invoke<void>('credential_clear', { key });
  },
};

export default credentialService;
