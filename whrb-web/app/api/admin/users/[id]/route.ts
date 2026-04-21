import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params;

  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }
  if (id === authz.user.id) {
    return NextResponse.json(
      { error: 'Cannot remove your own account.' },
      { status: 409 },
    );
  }

  const service = createServiceClient();
  const { data: target } = await service
    .from('profiles')
    .select('id, email, role')
    .eq('id', id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }
  if (target.role === 'admin') {
    const { count } = await service
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last admin.' },
        { status: 409 },
      );
    }
  }

  const { error } = await service.auth.admin.deleteUser(id);
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'admin_user_remove_failed',
      message: 'auth.admin.deleteUser failed',
      context: { target: id, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'admin_user_removed',
    message: `removed ${target.email}`,
    context: { target: id },
    userId: authz.user.id,
  });
  return NextResponse.json({ id: target.id, email: target.email });
}
