import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { createServiceClient } from '@/lib/supabase/service';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogSource = 'web_server' | 'web_client';

export interface LogEventInput {
  source: LogSource;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
  userId?: string | null;
  url?: string | null;
  httpStatus?: number | null;
}

export async function logEvent(input: LogEventInput): Promise<void> {
  // Dual sink: error/fatal events also go to Sentry so we get stack-grouped
  // alerting on top of the in-DB audit trail. captureMessage no-ops when
  // SENTRY_DSN is unset (kill-switch). Lower-severity events stay
  // Supabase-only — Sentry isn't an info/debug log store. Wrapped in
  // try/catch so an SDK failure can't preempt the Supabase write below —
  // the audit trail must not depend on Sentry being healthy.
  if (input.level === 'error' || input.level === 'fatal') {
    try {
      Sentry.withScope((scope) => {
        scope.setTag('category', input.category);
        scope.setTag('source', input.source);
        if (input.userId) scope.setUser({ id: input.userId });
        if (input.context) scope.setExtras(input.context);
        if (input.httpStatus) scope.setTag('http_status', String(input.httpStatus));
        Sentry.captureMessage(input.message, input.level === 'fatal' ? 'fatal' : 'error');
      });
    } catch (sentryErr) {
      console.error('[logEvent] Sentry capture failed, continuing to Supabase', sentryErr);
    }
  }

  try {
    const supabase = createServiceClient();
    await supabase.from('event_log').insert({
      source: input.source,
      level: input.level,
      category: input.category,
      message: input.message,
      context: input.context ?? {},
      user_id: input.userId ?? null,
      url: input.url ?? null,
      http_status: input.httpStatus ?? null,
    });
  } catch (err) {
    console.error('[logEvent] failed to insert event_log row', err);
    // If even the Supabase write fails, surface that to Sentry too — this
    // is exactly the kind of silent failure mode we're adding APM for.
    // Wrapped so a Sentry failure here doesn't bubble up either.
    try {
      Sentry.captureException(err, {
        tags: { category: 'event_log_insert_failed' },
        extra: { original_category: input.category, original_message: input.message },
      });
    } catch (sentryErr) {
      console.error('[logEvent] Sentry fallback capture also failed', sentryErr);
    }
  }
}
