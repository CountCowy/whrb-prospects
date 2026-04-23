import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

const PUBLIC_PATHS = ['/login', '/auth/callback'];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, user, response } = await updateSession(request);

  if (!user && !isPublic(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Stage 9: deactivated accounts are signed out on their next request and
  // redirected to /login?deactivated=1. This is the enforcement half of the
  // /admin/users "Deactivate" control.
  if (user && !isPublic(pathname)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('deactivated_at')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.deactivated_at) {
      await supabase.auth.signOut();
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/login';
      redirectUrl.search = '';
      redirectUrl.searchParams.set('deactivated', '1');
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (user && pathname === '/login') {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    // T1: media-kit-2026.pdf is intentionally public (anyone with the link
    // can download). Annual swap: rename to media-kit-<year>.pdf and update
    // the regex below + the MEDIA_KIT_PDF_FILENAME constant in
    // app/(app)/media-kit/page.tsx.
    '/((?!_next/static|_next/image|favicon.ico|whrb-logo.svg|whrb-logo-dark.svg|media-kit-2026.pdf|robots.txt|sitemap.xml|api/).*)',
  ],
};
