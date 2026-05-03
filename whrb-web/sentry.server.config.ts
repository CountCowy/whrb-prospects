import * as Sentry from '@sentry/nextjs';

import { sentryBeforeSend } from '@/lib/observability/sentry';

/**
 * Server-runtime Sentry init (Node.js).
 *
 * Imported by `instrumentation.ts` only when `NEXT_RUNTIME === 'nodejs'`.
 * If `SENTRY_DSN` is unset, `Sentry.init` no-ops — the SDK stays inert
 * so local dev and unconfigured CI runs don't try to phone home.
 *
 * Sampling defaults: 10% of transactions in production, 100% in dev.
 * `sendDefaultPii: false` — we explicitly attach the Supabase user via
 * `Sentry.setUser({id, email})` from `getAuthed()`; we never send raw
 * request bodies. `beforeSend` strips cookies / authorization headers /
 * password-shaped fields as a defense in depth.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  enabled: Boolean(process.env.SENTRY_DSN),

  // Tracing — modest sample rate; bump only when investigating perf.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // PII posture: explicit only.
  sendDefaultPii: false,

  beforeSend: sentryBeforeSend,
});
