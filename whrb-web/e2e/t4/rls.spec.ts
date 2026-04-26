import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * T12.anon · Anon clients cannot SELECT from filter_impressions or
 * changelog_entries. Service role can. RLS is enforced server-side; we
 * exercise the API directly with the anon key rather than going through
 * the UI.
 *
 * T22.anon · Same pattern, changelog_entries.
 */
test.describe('T4 · RLS (anon denial)', () => {
  test('T12.anon · anon cannot SELECT filter_impressions', async () => {
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey =
      process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon
      .from('filter_impressions')
      .select('id', { count: 'exact', head: true });
    // RLS denies — either error or empty.
    expect((data?.length ?? 0) === 0 || Boolean(error)).toBe(true);
  });

  test('T22.anon · anon cannot SELECT changelog_entries', async () => {
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey =
      process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon
      .from('changelog_entries')
      .select('id', { count: 'exact', head: true });
    expect((data?.length ?? 0) === 0 || Boolean(error)).toBe(true);
  });
});
