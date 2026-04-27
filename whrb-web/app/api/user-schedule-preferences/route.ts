import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import {
  DEFAULT_SCHEDULE_PREFS,
  mergeWithDefaults,
  type SchedulePrefs,
} from '@/lib/queries/schedule-prefs';
import { SCHEDULE_CATEGORIES } from '@/styles/schedule-colors';

export const runtime = 'nodejs';

const Patch = z.object({
  category: z.enum(SCHEDULE_CATEGORIES as unknown as [string, ...string[]]),
  prefs: z.object({
    lead_minutes: z
      .array(z.number().int().min(0).max(43200))
      .max(10),
    channels: z.array(z.enum(['in_app', 'email'])).min(0).max(2),
  }),
});

export async function GET() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_schedule_preferences')
    .select('prefs')
    .eq('user_id', authz.user.id)
    .maybeSingle();
  return NextResponse.json({
    prefs: mergeWithDefaults(
      (data?.prefs ?? null) as Partial<SchedulePrefs> | null,
    ),
  });
}

export async function PATCH(req: NextRequest) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Patch.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid: ${issue.path.join('.')} — ${issue.message}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('user_schedule_preferences')
    .select('prefs')
    .eq('user_id', authz.user.id)
    .maybeSingle();

  const current = mergeWithDefaults(
    (existing?.prefs ?? null) as Partial<SchedulePrefs> | null,
  );
  const next: SchedulePrefs = {
    ...current,
    [parsed.data.category]: {
      lead_minutes: Array.from(new Set(parsed.data.prefs.lead_minutes)).sort(
        (a, b) => a - b,
      ),
      channels: Array.from(new Set(parsed.data.prefs.channels)),
    },
  };

  const { error } = await supabase
    .from('user_schedule_preferences')
    .upsert(
      { user_id: authz.user.id, prefs: next },
      { onConflict: 'user_id' },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ prefs: next });
}

export const _DEFAULTS = DEFAULT_SCHEDULE_PREFS;
