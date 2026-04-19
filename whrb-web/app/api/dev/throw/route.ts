import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/logging/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    throw new Error('Intentional test exception from /api/dev/throw');
  } catch (err) {
    const e = err as Error;
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: e.message,
      context: { stack: e.stack },
      userId: user.id,
      url: new URL(request.url).pathname,
    });
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
