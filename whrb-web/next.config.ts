import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

/**
 * Wrap the app config with `withSentryConfig` so Sentry can:
 *
 * * Upload source maps to make stack traces readable (gated on
 *   `SENTRY_AUTH_TOKEN` — unset locally, set in CI/Vercel).
 * * Tunnel events through `/api/monitoring` so ad-blockers don't drop them.
 *
 * Every option below is no-op when the corresponding env var is unset —
 * unconfigured local builds (no Sentry secrets) work unchanged.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet build logs unless we're in CI, where verbose output is useful.
  silent: !process.env.CI,

  // Upload a wider net of source maps for prettier stack traces.
  widenClientFileUpload: true,

  // Tunnel Sentry through our own server to sidestep ad-blockers. Lives
  // under /api/* because middleware.ts excludes that prefix from the auth
  // matcher — a tunnel at the root (e.g. /monitoring) would be redirected
  // to /login for unauthenticated requests, dropping client-side errors
  // from the login page itself and any pre-auth crash.
  tunnelRoute: '/api/monitoring',
});
