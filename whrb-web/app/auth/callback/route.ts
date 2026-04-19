import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/logging/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) {
    const redirect = new URL('/login', request.url);
    redirect.searchParams.set('error', 'Missing auth code');
    return NextResponse.redirect(redirect);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'auth_callback_error',
      message: error.message,
      url: url.pathname,
    });
    const redirect = new URL('/login', request.url);
    redirect.searchParams.set('error', error.message);
    return NextResponse.redirect(redirect);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
