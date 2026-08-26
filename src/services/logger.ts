import { invoke } from '@tauri-apps/api/core';

export type AppLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

async function write(level: AppLogLevel, event: string, message = ''): Promise<void> {
  const consoleMethod = level === 'ERROR'
    ? console.error
    : level === 'WARN'
      ? console.warn
      : console.info;
  consoleMethod(`[${event}] ${message}`);

  try {
    await invoke<void>('append_app_log', { level, event, message });
  } catch (error) {
    console.warn('[logger.persist_failed]', describeError(error));
  }
}

export const appLogger = {
  debug(event: string, message = ''): Promise<void> {
    return write('DEBUG', event, message);
  },
  info(event: string, message = ''): Promise<void> {
    return write('INFO', event, message);
  },
  warn(event: string, message = ''): Promise<void> {
    return write('WARN', event, message);
  },
  error(event: string, error: unknown): Promise<void> {
    return write('ERROR', event, describeError(error));
  },
  getPath(): Promise<string> {
    return invoke<string>('get_app_log_path');
  },
};

export default appLogger;
