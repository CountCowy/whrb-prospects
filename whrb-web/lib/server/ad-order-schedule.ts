import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/logging/server';
import { getOrgSettingsService } from '@/lib/queries/ad-orders';

/**
 * Insert (or refresh) the two schedule_events linked to an ad_order:
 *
 *   1) `sold_ad_airing` — at campaign_start, all-day, team-wide
 *   2) `invoice_due`    — at campaign_start + default_invoice_net_days,
 *                         all-day, admin-only assignee
 *
 * Both rows store `metadata.ad_order_id = <id>` so the ad-order detail
 * tab can join back. We use the service-role client so that RLS does not
 * block the insert when the actor is an admin in a normal API context.
 *
 * Idempotent: if events already exist for this ad_order, they are
 * UPDATE'd in place (the existing `t_sched_reschedule` AFTER UPDATE
 * trigger then refreshes any pending reminders).
 *
 * Best-effort: failures here are logged and swallowed. The ad_order
 * itself has already been committed; missing reminders are recoverable
 * by editing the order. Surfacing the error to the caller would force a
 * confusing "ad created but reminders failed" UX.
 */
export async function syncAdOrderScheduleEvents(input: {
  adOrderId: string;
  promoId: string;
  companyName: string;
  campaignStart: string; // YYYY-MM-DD
  prospectId: string | null;
  actorId: string | null;
}): Promise<void> {
  try {
    const supabase = createServiceClient();
    const settings = await getOrgSettingsService();
    const netDays = settings.default_invoice_net_days;

    const startsAt = `${input.campaignStart}T13:00:00Z`; // 09:00 ET-ish; renderer rounds with all_day=true
    const dueDate = addDays(input.campaignStart, netDays);
    const dueAt = `${dueDate}T13:00:00Z`;

    const airingPayload = {
      title: `Ad airing: ${input.promoId} — ${truncate(input.companyName, 80)}`,
      description: `Sold ad goes live for ${input.companyName}. (Linked ad_order ${input.adOrderId})`,
      category: 'sold_ad_airing' as const,
      starts_at: startsAt,
      duration_minutes: 60,
      all_day: true,
      assignee_kind: 'team_wide' as const,
      assigned_to: null,
      author_id: input.actorId,
      prospect_id: input.prospectId,
      visibility: 'public' as const,
      metadata: { ad_order_id: input.adOrderId, kind: 'sold_ad_airing' },
    };

    const invoicePayload = {
      title: `Invoice due: ${input.promoId} — ${truncate(input.companyName, 80)}`,
      description: `Send invoice for ${input.companyName} (${input.promoId}). Net ${netDays} days from campaign start.`,
      category: 'invoice_due' as const,
      starts_at: dueAt,
      duration_minutes: 30,
      all_day: true,
      assignee_kind: 'admin' as const,
      assigned_to: null,
      author_id: input.actorId,
      prospect_id: input.prospectId,
      visibility: 'public' as const,
      metadata: { ad_order_id: input.adOrderId, kind: 'invoice_due' },
    };

    // Look up existing rows by metadata.
    const { data: existing } = await supabase
      .from('schedule_events')
      .select('id, metadata')
      .contains('metadata', { ad_order_id: input.adOrderId });

    const byKind = new Map<string, string>();
    for (const row of (existing ?? []) as Array<{ id: string; metadata: Record<string, unknown> }>) {
      const kind = (row.metadata as { kind?: string }).kind;
      if (typeof kind === 'string') byKind.set(kind, row.id);
    }

    for (const payload of [airingPayload, invoicePayload] as const) {
      const existingId = byKind.get(payload.metadata.kind);
      if (existingId) {
        await supabase.from('schedule_events').update(payload).eq('id', existingId);
      } else {
        await supabase.from('schedule_events').insert(payload);
      }
    }
  } catch (err) {
    await logEvent({
      source: 'web_server',
      level: 'warn',
      category: 'ad_order_schedule_sync_failed',
      message: 'failed to sync ad_order schedule_events',
      context: {
        ad_order_id: input.adOrderId,
        promo_id: input.promoId,
        error: err instanceof Error ? err.message : String(err),
      },
      userId: input.actorId,
    });
  }
}

/**
 * Remove the linked schedule_events when an ad_order is archived.
 * Best-effort.
 */
export async function clearAdOrderScheduleEvents(adOrderId: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('schedule_events')
      .delete()
      .contains('metadata', { ad_order_id: adOrderId });
  } catch (err) {
    await logEvent({
      source: 'web_server',
      level: 'warn',
      category: 'ad_order_schedule_clear_failed',
      message: 'failed to clear ad_order schedule_events',
      context: { ad_order_id: adOrderId, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
