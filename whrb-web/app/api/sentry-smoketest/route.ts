import { NextResponse } from 'next/server';

/**
 * Temporary smoke-test route for the post-T7 Sentry rollout.
 *
 * Hit this once per deploy environment (Preview + Production) to confirm:
 *
 *   1. Sentry receives the event.
 *   2. The event is tagged with the right environment / release.
 *   3. PII scrubbing kept secrets out of the payload.
 *   4. The Supabase `event_log` row was also written (alongside-not-replace).
 *
 * Refuses to fire in production builds — reduces the risk of a forgotten
 * test endpoint becoming a denial-of-service vector. Remove this file in
 * a follow-up commit once the first deploy verification is logged.
 *
 * Named "smoketest" (no leading underscore) because Next.js App Router
 * treats any folder starting with `_` as a private/non-routed folder.
 * The "smoketest" suffix is obvious-on-grep when it's time to delete.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production') {
    return NextResponse.json(
      { error: 'sentry-smoketest is disabled in production builds.' },
      { status: 404 },
    );
  }
  throw new Error('Sentry smoke test — intentional throw from /api/sentry-smoketest');
}
