import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/changelog/ack
 *
 * Sets `profiles.last_changelog_ack = now()` for the current user. Called
 * by the first-login changelog toast on dismiss / link-click. No body.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ last_changelog_ack: new Date().toISOString() })
    .eq('id', user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
