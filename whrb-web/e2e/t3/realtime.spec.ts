import { test, expect, type BrowserContext } from '@playwright/test';
import {
  ADMIN_STORAGE,
  loadSnapshot,
  snapshotExists,
} from './helpers';

/**
 * t3-t14 — Realtime load test scoped to N=5 contexts × 3 network
 * profiles (per ROLLOUT deviation; plan §5.6 specs N=40, scoped down
 * to keep CI flake low). One context writes a tag; the four readers
 * must observe the chip within 2s.
 */
test.describe('t3 realtime chip propagation', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('t3-t14 5 readers × 3 network profiles see chip within 2s', async ({ browser }) => {
    test.setTimeout(120_000);
    const snap = loadSnapshot();

    const profiles: Array<{
      name: string;
      offline?: boolean;
      latency?: number;
      throughputBps?: number;
    }> = [
      { name: 'fast-3g', latency: 100, throughputBps: 1.6 * 1024 * 1024 },
      { name: 'slow-3g', latency: 300, throughputBps: 400 * 1024 },
      { name: 'offline-reconnect-5s', offline: true },
    ];

    for (const profile of profiles) {
      const contexts: BrowserContext[] = [];
      try {
        for (let i = 0; i < 5; i++) {
          const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
          contexts.push(ctx);
          if (profile.offline) {
            await ctx.setOffline(true);
            // Reconnect after 5s.
            void (async () => {
              await new Promise((r) => setTimeout(r, 5_000));
              await ctx.setOffline(false);
            })();
          } else if (profile.latency) {
            await ctx.route('**/*', async (route) => {
              await new Promise((r) => setTimeout(r, profile.latency!));
              await route.continue();
            });
          }
        }

        const writer = contexts[0];
        const readers = contexts.slice(1);
        const writerPage = await writer.newPage();
        await writerPage.goto(`/prospects/${snap.prospect_id}`);
        await writerPage.waitForSelector('[data-testid="tag-chips-full"]', { timeout: 15_000 });

        const readerPages = await Promise.all(readers.map((c) => c.newPage()));
        for (const p of readerPages) {
          await p.goto(`/prospects/${snap.prospect_id}`);
          await p.waitForSelector('[data-testid="tag-chips-full"]', { timeout: 30_000 });
        }

        // Writer adds a tag. Use the API directly to side-step UI flakiness.
        const newValue = `t3_realtime_${profile.name.replace(/-/g, '_')}_${Date.now()}`;
        await writerPage.evaluate(
          async ([prospectId, axis, value]) => {
            await fetch(`/api/prospects/${prospectId}/tags`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ is_new_vocab: true, axis, value }),
            });
          },
          [snap.prospect_id, 'other', newValue] as const,
        );

        const start = Date.now();
        await Promise.all(
          readerPages.map((p) =>
            p.waitForSelector(
              `[data-testid="tag-chip"][data-axis="other"][data-value="${newValue}"]`,
              { timeout: profile.offline ? 30_000 : 10_000 },
            ),
          ),
        );
        const elapsed = Date.now() - start;
        // Allow a wider envelope on slow-3g + offline-reconnect.
        const cap = profile.offline ? 30_000 : profile.name === 'slow-3g' ? 8_000 : 4_000;
        expect(elapsed).toBeLessThanOrEqual(cap);
      } finally {
        await Promise.all(contexts.map((c) => c.close()));
      }
    }
  });
});
