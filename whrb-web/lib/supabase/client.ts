'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requirePublicEnv } from '@/lib/env';

export function createClient() {
  const { url, anonKey } = requirePublicEnv();
  return createBrowserClient(url, anonKey);
}
