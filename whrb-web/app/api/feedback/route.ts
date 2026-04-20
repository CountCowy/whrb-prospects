import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/logging/server';

const Body = z.object({
  body: z.string().min(1).max(2000),
  category: z.enum(['bug', 'idea', 'data_issue', 'other']).default('other'),
  page_url: z.string().url().max(2048).optional(),
  user_agent: z.string().max(1024).optional(),
});

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${first.path.join('.') || '<root>'} — ${first.message}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const insert = {
    author_id: user.id,
    body: parsed.data.body.trim(),
    category: parsed.data.category,
    page_url: parsed.data.page_url ?? null,
    user_agent: parsed.data.user_agent ?? null,
  };

  const { data, error } = await supabase
    .from('feedback')
    .insert(insert)
    .select('id,created_at')
    .single();

  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'feedback insert failed',
      context: { code: error.code, message: error.message },
      userId: user.id,
    });
    return NextResponse.json({ error: 'Could not save feedback.' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, created_at: data.created_at }, { status: 201 });
}
