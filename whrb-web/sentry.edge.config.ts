import * as Sentry from '@sentry/nextjs';

import { sentryBeforeSend } from '@/lib/observability/sentry';

/**
 * Edge-runtime Sentry init.
 *
 * Imported by `instrumentation.ts` only when `NEXT_RUNTIME === 'edge'`
 * (middleware + edge route handlers). Edge runtime has a smaller API
 * surface than Node — no filesystem, no native deps — so this config
 * stays minimal. Same DSN + sampling posture as the server runtime.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  enabled: Boolean(process.env.SENTRY_DSN),

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  sendDefaultPii: false,

  beforeSend: sentryBeforeSend,
});
