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
// Word-bounded so we don't false-positive on `passenger` / `passport` / `tokenizer`.
const SENSITIVE_FIELD_PATTERN = /\b(pass(word|wd)|secret|token|api[_-]?key)\b/i;
// URL search-param keys that should be scrubbed from breadcrumb URLs. Same
// vocabulary as SENSITIVE_FIELD_PATTERN plus auth-flow tokens that arrive
// as query params (?code=, ?reset_token=, ?invite=).
const SENSITIVE_QUERY_KEYS = /^(pass(word|wd)|secret|token|api[_-]?key|access_token|id_token|refresh_token|reset_token|invite|code)$/i;

/**
 * Recursively walk a JSON-shaped payload and replace any field whose key
 * matches the sensitive pattern with the literal string `'[Filtered]'`.
 * Mutates `value` in place and returns it.
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
 * Strip sensitive search params from a URL string. Returns the input
 * unchanged if it doesn't parse as a URL (relative paths, opaque hrefs).
 */
function scrubUrlParams(href: string): string {
  try {
    const url = new URL(href);
    let mutated = false;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) {
        url.searchParams.set(key, '[Filtered]');
        mutated = true;
      }
    }
    return mutated ? url.toString() : href;
  } catch {
    return href;
  }
}

/**
 * `beforeSend` hook for the server + edge runtime configs. Performs:
 *
 * 1. Strip sensitive request headers (cookie, authorization, etc.).
 * 2. Strip password-/secret-/token-shaped fields from `request.data` and
 *    `extra` payloads.
 * 3. Strip sensitive query-string params from breadcrumb URLs (Sentry's
 *    auto-instrumented fetch / navigation breadcrumbs include full URLs;
 *    a redirect like `/?reset_token=abc` would otherwise leak).
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
  if (req?.url) {
    req.url = scrubUrlParams(req.url);
  }
  if (event.extra) {
    event.extra = scrubSensitiveFields(event.extra) as typeof event.extra;
  }
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data && typeof crumb.data === 'object') {
        const data = crumb.data as Record<string, unknown>;
        if (typeof data.url === 'string') data.url = scrubUrlParams(data.url);
        if (typeof data.to === 'string') data.to = scrubUrlParams(data.to);
        if (typeof data.from === 'string') data.from = scrubUrlParams(data.from);
      }
    }
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
