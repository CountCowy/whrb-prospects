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
 * The route is intentionally double-underscore-prefixed so it sorts away
 * from real routes in directory listings and is obvious-on-grep when it's
 * time to delete.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production') {
    return NextResponse.json(
      { error: 'sentry-test is disabled in production builds.' },
      { status: 404 },
    );
  }
  throw new Error('Sentry smoke test — intentional throw from /__sentry-test');
}
