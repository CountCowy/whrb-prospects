import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requirePublicEnv } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = requirePublicEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll called from Server Component — middleware refreshes the session
        }
      },
    },
  });
}
