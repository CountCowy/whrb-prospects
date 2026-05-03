import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { setSentryUserFromAuthed } from '@/lib/observability/sentry';

export type AuthedUser = {
  id: string;
  email: string;
  role: 'admin' | 'rep';
};

export type AuthzResult =
  | { kind: 'unauth' }
  | { kind: 'authed'; user: AuthedUser };

export type RequireAdminResult =
  | { kind: 'unauth' }
  | { kind: 'forbidden' }
  | { kind: 'ok'; user: AuthedUser };

export async function getAuthed(): Promise<AuthzResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'unauth' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,email,role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return { kind: 'unauth' };
  const authedUser: AuthedUser = {
    id: profile.id as string,
    email: profile.email as string,
    role: profile.role as 'admin' | 'rep',
  };
  // Side-effect: scope subsequent Sentry events to this user. No-ops when
  // Sentry isn't initialised. Centralised here so individual route
  // handlers don't have to remember to call setSentryUserFromAuthed.
  setSentryUserFromAuthed(authedUser);
  return { kind: 'authed', user: authedUser };
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') return { kind: 'unauth' };
  if (authz.user.role !== 'admin') return { kind: 'forbidden' };
  return { kind: 'ok', user: authz.user };
}
