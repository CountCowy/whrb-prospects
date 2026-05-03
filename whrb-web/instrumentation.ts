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
 *
 * Wrapped with an explicit `Sentry.flush(2000)` because Vercel's
 * serverless runtime kills the function process as soon as the response
 * is sent. Without flushing here, captured events queued by
 * `Sentry.captureRequestError` never make it to the ingest endpoint.
 * This was verified empirically against `/api/sentry-debug?action=throw`
 * before this wrapper was added — explicit captures + flush landed,
 * implicit `onRequestError` captures did not. The 2-second budget
 * matches Sentry's documented serverless-flush guidance.
 */
export const onRequestError = async (
  ...args: Parameters<typeof Sentry.captureRequestError>
): Promise<void> => {
  Sentry.captureRequestError(...args);
  await Sentry.flush(2000);
};
