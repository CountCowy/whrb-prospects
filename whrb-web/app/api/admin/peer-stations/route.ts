import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { normalizeName } from '@/lib/norm-name';

export const runtime = 'nodejs';

const STATUSES = ['active', 'deprecated'] as const;

const Body = z.object({
  display_name: z.string().min(1).max(120),
  // normalized_name is optional — derived from display_name when omitted.
  // When provided, must already be in canonical form (round-trip equal to
  // normalizeName(it)) so writes here exactly match the scraper-side
  // semantics in `enrich/dedupe.py::_norm_name`.
  normalized_name: z.string().min(1).max(120).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(req: Request) {
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

  const display_name = parsed.data.display_name.trim();
  const userProvidedNorm = parsed.data.normalized_name?.trim();
  if (userProvidedNorm && userProvidedNorm !== normalizeName(userProvidedNorm)) {
    return NextResponse.json(
      {
        error:
          'normalized_name must be canonical (lowercase, no punctuation, single-spaced). Omit to derive from display_name.',
      },
      { status: 400 },
    );
  }
  const normalized_name = userProvidedNorm || normalizeName(display_name);
  if (!normalized_name) {
    return NextResponse.json(
      { error: 'normalized_name resolved to empty string.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const insertPayload: Record<string, unknown> = {
    display_name,
    normalized_name,
    added_by: authz.user.id,
  };
  if (parsed.data.status) insertPayload.status = parsed.data.status;
  if (parsed.data.notes !== undefined) insertPayload.notes = parsed.data.notes;

  const { data, error } = await supabase
    .from('peer_stations')
    .insert(insertPayload)
    .select(
      'id, normalized_name, display_name, status, added_by, notes, created_at, updated_at',
    )
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Peer station "${normalized_name}" already exists.` },
        { status: 409 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'peer_stations POST failed',
      context: {
        normalized_name,
        code: error.code,
        message: error.message,
      },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'peer_station_created',
    message: `created peer station ${display_name}`,
    context: {
      id: data?.id,
      normalized_name,
      display_name,
    },
    userId: authz.user.id,
  });

  return NextResponse.json(data, { status: 201 });
}
