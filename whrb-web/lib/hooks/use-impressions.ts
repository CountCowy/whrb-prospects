'use client';

import { useEffect } from 'react';

/**
 * Records visible-row impressions for source-quality instrumentation.
 *
 * Behavior:
 *   - On mount + whenever `key` (filter signature + page hash) changes,
 *     POSTs the current `prospectIds` to `/api/prospects/impressions`.
 *   - Per-(key+ids) sessionStorage dedup so a back/forward navigation or
 *     a remount doesn't double-emit. The DB-side daily-unique index is
 *     the durable backstop.
 *   - Fire-and-forget — failures are silent. We don't want to add a
 *     loading state for an analytics ping.
 *
 * The `key` should be a hash of the URL searchParams that produced the
 * visible row set; the simplest implementation passes the whole search
 * string. The server inserts one row per prospect with `user_id`
 * stamped from `auth.uid()`, so no client-side identity needed.
 */
export function useImpressions(prospectIds: string[], key: string) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (prospectIds.length === 0) return;

    const idsHash = prospectIds.slice().sort().join(',');
    const storageKey = `impressions:${key}:${idsHash}`;
    if (window.sessionStorage.getItem(storageKey)) return;

    fetch('/api/prospects/impressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prospect_ids: prospectIds,
        filter_signature: key.slice(0, 120),
      }),
    })
      .then(() => {
        try {
          window.sessionStorage.setItem(storageKey, '1');
        } catch {
          // sessionStorage quota — accept the rare double-emit. The DB
          // unique index drops it.
        }
      })
      .catch(() => {
        // analytics-grade error swallow
      });
  }, [prospectIds, key]);
}
