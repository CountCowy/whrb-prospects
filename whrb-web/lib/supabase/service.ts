import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireServiceRole } from '@/lib/env.server';

export function createServiceClient() {
  const { url, serviceKey } = requireServiceRole();
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
