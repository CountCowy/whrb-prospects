/**
 * Sentry integration seam.
 *
 * The app already has a custom logging stack at `lib/logging/{client,server}.ts`
 * that writes to the Supabase `event_log` table. Sentry is **additive**: it
 * catches the same events as a second sink so we get stack-trace-grouped
 * runtime visibility without losing the in-DB audit trail. Helpers here:
 *
 * * {@link sentryBeforeSend} — defense-in-depth PII scrub, attached as the
 *   `beforeSend` hook in both `sentry.server.config.ts` and
 *   `sentry.edge.config.ts`. Strips cookies / authorization headers /
 *   password-shaped fields from the payload Sentry would otherwise see.
 * * {@link captureServerError} — call from server-side error paths
 *   (route handlers, server actions) alongside the existing
 *   `logEvent({level: 'error', ...})`. No-ops if Sentry isn't initialised.
 * * {@link setSentryUserFromAuthed} — server-side user scoping. Pass the
 *   `AuthedUser` returned by `getAuthed()`; the helper attaches `id` +
 *   `email` to the Sentry scope and tags the role. Safe to call even
 *   when `SENTRY_DSN` is unset.
 */
import * as Sentry from '@sentry/nextjs';

import type { AuthedUser } from '@/lib/server/authz';

/** Headers and field names that should never reach Sentry. */
const SENSITIVE_HEADERS = new Set(['cookie', 'authorization', 'set-cookie', 'x-api-key']);
const SENSITIVE_FIELD_PATTERN = /pass(word|wd)|secret|token|api[_-]?key/i;

/**
 * Recursively walk a JSON-shaped payload and replace any field whose key
 * matches the sensitive pattern with the literal string `'[Filtered]'`.
 * Returns the (mutated) input.
 */
function scrubSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubSensitiveFields(value[i], depth + 1);
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      obj[key] = '[Filtered]';
    } else {
      obj[key] = scrubSensitiveFields(obj[key], depth + 1);
    }
  }
  return obj;
}

/**
 * `beforeSend` hook for the server + edge runtime configs. Performs:
 *
 * 1. Strip sensitive request headers (cookie, authorization, etc.).
 * 2. Strip password-/secret-/token-shaped fields from `request.data`,
 *    `request.query_string`, and `extra` payloads.
 *
 * Sentry's built-in PII scrubber covers most cases when `sendDefaultPii`
 * is `false`, but explicit scrubbing here means we don't depend on a
 * config flag flip to keep credentials out of error reports.
 */
export function sentryBeforeSend(
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent | null {
  const req = event.request;
  if (req?.headers) {
    for (const name of Object.keys(req.headers)) {
      if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
        req.headers[name] = '[Filtered]';
      }
    }
  }
  if (req?.data !== undefined) {
    req.data = scrubSensitiveFields(req.data) as typeof req.data;
  }
  if (event.extra) {
    event.extra = scrubSensitiveFields(event.extra) as typeof event.extra;
  }
  return event;
}

/**
 * Capture a server-side exception with optional context. Call alongside
 * the existing `logEvent({level: 'error', ...})` in `lib/logging/server.ts`
 * so both sinks see the same error.
 *
 * No-ops gracefully when `SENTRY_DSN` is unset (`Sentry.init` skipped).
 */
export function captureServerError(
  err: unknown,
  context?: { category?: string; userId?: string | null; extra?: Record<string, unknown> },
): void {
  Sentry.withScope((scope) => {
    if (context?.category) scope.setTag('category', context.category);
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context?.extra) scope.setExtras(context.extra);
    scope.setLevel('error');
    Sentry.captureException(err);
  });
}

/**
 * Attach the current Supabase user to the Sentry scope so subsequent
 * captured events get tagged with their identity. Call from places that
 * already have an `AuthedUser` in hand (route handler post-`getAuthed()`,
 * server action entry, etc.).
 *
 * `role` lands as a tag (queryable, lower cardinality) rather than as a
 * field on `Sentry.User` — Sentry's user shape only really supports
 * `id`/`email`/`username`/`ip_address`.
 */
export function setSentryUserFromAuthed(user: AuthedUser): void {
  Sentry.setUser({ id: user.id, email: user.email });
  Sentry.setTag('role', user.role);
}

/** Clear any user attached to the current scope. */
export function clearSentryUser(): void {
  Sentry.setUser(null);
}
