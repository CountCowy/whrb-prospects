import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const Body = z.object({
  target_id: z.string().uuid(),
});

type RouteParams = { params: Promise<{ id: string }> };

type MergeResult = {
  affected_prospect_count: number;
  collision_count: number;
  from_axis: string;
  from_value: string;
  to_axis: string;
  to_value: string;
};

export async function POST(req: Request, { params }: RouteParams) {
  const { id: sourceId } = await params;

  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}`,
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merge_tag_vocabulary', {
    p_source_id: sourceId,
    p_target_id: parsed.data.target_id,
  });

  if (error) {
    // Translate Postgres custom errcodes to HTTP status:
    //   P0001 = either id not found            -> 404
    //   P0002 = cross-axis merge denied        -> 400 (per plan §1.3 #22)
    //   P0003 = self-merge                     -> 400
    const code = error.code;
    if (code === 'P0002') {
      return NextResponse.json(
        {
          error:
            'Cross-axis merge denied. Change the source tag axis first, then retry.',
          code,
        },
        { status: 400 },
      );
    }
    if (code === 'P0003') {
      return NextResponse.json(
        { error: 'Cannot merge a tag into itself.', code },
        { status: 400 },
      );
    }
    if (code === 'P0001') {
      return NextResponse.json(
        { error: 'Source or target tag not found.', code },
        { status: 404 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'merge_tag_vocabulary RPC failed',
      context: {
        source_id: sourceId,
        target_id: parsed.data.target_id,
        code,
        message: error.message,
      },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as MergeResult;
  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'tag_merge',
    message: `merged ${result.from_axis}:${result.from_value} -> ${result.to_axis}:${result.to_value}`,
    context: {
      from_id: sourceId,
      to_id: parsed.data.target_id,
      affected_count: result.affected_prospect_count,
      collision_count: result.collision_count,
    },
    userId: authz.user.id,
  });

  return NextResponse.json(result, { status: 200 });
}
