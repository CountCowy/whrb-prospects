import * as Sentry from '@sentry/nextjs';

/**
 * Next.js 15 instrumentation hook (Sentry SDK v10 pattern).
 *
 * Loaded once at server start. Imports the runtime-specific Sentry init
 * file based on `NEXT_RUNTIME`, which Vercel sets to `'nodejs'` on the
 * Node runtime and `'edge'` for edge functions / middleware.
 *
 * Both configs gate on `process.env.SENTRY_DSN` so the SDK stays inert
 * when the env var is unset (local dev, CI without secrets, kill-switch
 * rollback in prod).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Capture errors thrown inside Server Components, route handlers, server
 * actions, and middleware. Without this export those would land as
 * unhandled rejections — Sentry exposes a single hook to wire them up.
 */
export const onRequestError = Sentry.captureRequestError;
