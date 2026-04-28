import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { validateFeedUrl } from '@/lib/server/safe-feed-url';
import { SCHEDULE_CATEGORIES } from '@/styles/schedule-colors';

export const runtime = 'nodejs';

const PostBody = z.object({
  name: z.string().min(1).max(200),
  feed_url: z.string().url().max(2048),
  default_category: z
    .enum(SCHEDULE_CATEGORIES as unknown as [string, ...string[]])
    .optional(),
  default_assignee_kind: z.enum(['user', 'team_wide', 'admin']).optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  const r = await requireAdmin();
  if (r.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (r.kind === 'forbidden') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_external_calendars')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const r = await requireAdmin();
  if (r.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (r.kind === 'forbidden') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid: ${issue.path.join('.')} — ${issue.message}` },
      { status: 400 },
    );
  }
  const urlCheck = validateFeedUrl(parsed.data.feed_url);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_external_calendars')
    .insert({
      name: parsed.data.name,
      feed_url: parsed.data.feed_url,
      default_category: parsed.data.default_category ?? 'internal_event',
      default_assignee_kind:
        parsed.data.default_assignee_kind ?? 'team_wide',
      enabled: parsed.data.enabled ?? true,
      created_by: r.user.id,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'schedule_ext_cal_create',
    message: `external calendar ${parsed.data.name} added`,
    context: { id: data.id, name: parsed.data.name },
    userId: r.user.id,
  });
  return NextResponse.json(data, { status: 201 });
}
