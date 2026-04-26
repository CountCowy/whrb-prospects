import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const CreateBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'slug must be kebab-case lowercase',
    }),
  title: z.string().min(1).max(60),
  body_mdx: z.string().min(1).max(8000),
  audience: z.enum(['all', 'rep', 'admin']).default('all'),
  pinned: z.boolean().default(false),
  released_at: z.string().datetime().optional(),
});

/**
 * POST /api/admin/changelog
 *
 * Admin-only. Inserts a `changelog_entries` row. RLS already enforces
 * admin-only writes; we do a redundant role check up front so the error
 * message is friendlier than the RLS rejection.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid body' },
      { status: 400 },
    );
  }

  // Word-count guard (mirror of client-side check).
  const words = parsed.data.body_mdx.trim().split(/\s+/).filter(Boolean).length;
  if (words > 500) {
    return NextResponse.json(
      { error: `body exceeds 500 words (${words})` },
      { status: 400 },
    );
  }

  const releasedAt = parsed.data.released_at ?? new Date().toISOString();

  const { data, error } = await supabase
    .from('changelog_entries')
    .insert({
      slug: parsed.data.slug,
      title: parsed.data.title,
      body_mdx: parsed.data.body_mdx,
      audience: parsed.data.audience,
      pinned: parsed.data.pinned,
      released_at: releasedAt,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entry: data }, { status: 201 });
}
