'use client';

export type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ClientLogInput {
  level: ClientLogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
  url?: string;
}

export async function logClient(input: ClientLogInput): Promise<void> {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, url: input.url ?? window.location.pathname }),
      keepalive: true,
    });
  } catch {
    // swallow — logging must never crash the app
  }
}

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('unhandledrejection', (ev) => {
    const reason =
      ev.reason instanceof Error
        ? { message: ev.reason.message, stack: ev.reason.stack }
        : { message: String(ev.reason) };
    void logClient({
      level: 'error',
      category: 'unhandled_rejection',
      message: reason.message,
      context: { stack: 'stack' in reason ? reason.stack : undefined },
    });
  });

  window.addEventListener('error', (ev) => {
    const err = ev.error instanceof Error ? ev.error : null;
    void logClient({
      level: 'error',
      category: 'ui_exception',
      message: err?.message ?? String(ev.message ?? 'window.onerror'),
      context: {
        stack: err?.stack,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      },
    });
  });
}
