import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

/**
 * Diagnostic route — surfaces whether Sentry is initialized server-side
 * and whether captured errors actually reach the ingest endpoint.
 *
 * Three actions selected via `?action=`:
 *   - status (default): report what the SDK thinks its config is
 *   - capture: synchronously call captureMessage + flush, return result
 *   - throw:   throw an Error so Next's onRequestError fires
 *
 * Refuses to fire in production builds. Remove this file once Sentry is
 * confirmed working on Vercel preview.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ error: 'disabled in production builds' }, { status: 404 });
  }

  const action = new URL(req.url).searchParams.get('action') ?? 'status';
  const dsnPresent = Boolean(process.env.SENTRY_DSN);
  const publicDsnPresent = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const client = Sentry.getClient();
  const isInitialized = Boolean(client);
  const dsnOnClient = client?.getDsn();
  const runtime = process.env.NEXT_RUNTIME ?? 'unknown';

  if (action === 'status') {
    return NextResponse.json({
      action: 'status',
      runtime,
      env: {
        VERCEL_ENV: process.env.VERCEL_ENV ?? null,
        NODE_ENV: process.env.NODE_ENV ?? null,
      },
      sentry: {
        dsn_env_present: dsnPresent,
        next_public_dsn_env_present: publicDsnPresent,
        client_initialized: isInitialized,
        client_dsn_host: dsnOnClient ? `${dsnOnClient.protocol}//${dsnOnClient.host}` : null,
        client_dsn_project_id: dsnOnClient?.projectId ?? null,
      },
    });
  }

  if (action === 'capture') {
    const eventId = Sentry.captureMessage('Sentry SDK validation ping (captureMessage)', 'error');
    const flushed = await Sentry.flush(5000);
    return NextResponse.json({
      action: 'capture',
      eventId,
      flushed,
      runtime,
      sentry_initialized: isInitialized,
    });
  }

  if (action === 'throw') {
    // Capture explicitly THEN throw, so even if onRequestError doesn't fire
    // we still send something. Flush before throwing so the event reaches
    // Sentry before the serverless function terminates.
    Sentry.captureException(new Error('Sentry diagnostic: explicit captureException pre-throw'));
    await Sentry.flush(5000);
    throw new Error('Sentry diagnostic: intentional throw after captureException');
  }

  return NextResponse.json({ error: 'unknown action', valid: ['status', 'capture', 'throw'] }, { status: 400 });
}
