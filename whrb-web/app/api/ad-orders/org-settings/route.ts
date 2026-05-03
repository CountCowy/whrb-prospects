import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAuthed, requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { OrgSettingsPatchSchema, getOrgSettings } from '@/lib/queries/ad-orders';

export const runtime = 'nodejs';

export async function GET() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  try {
    const settings = await getOrgSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Read failed.' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const authz = await requireAdmin();
  if (authz.kind === 'unauth') return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  if (authz.kind === 'forbidden') return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = OrgSettingsPatchSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const update: Record<string, unknown> = { ...parsed.data, updated_by: authz.user.id };
  // Drop undefined keys so we don't send them.
  for (const k of Object.keys(update)) {
    if (update[k] === undefined) delete update[k];
  }

  const { error } = await supabase.from('org_settings').update(update).eq('id', true);
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'org_settings_patch_failed',
      message: 'PATCH /api/ad-orders/org-settings failed',
      context: { code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 400 });
  }
  return NextResponse.json({ ok: true });
}
