import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const CreateBody = z.object({
  company_name: z.string().min(1).max(300),
  tier: z.enum(['A', 'B', 'C']).default('C'),
  state: z
    .enum([
      'researching',
      'waiting_response',
      'initial_contact',
      'ongoing_contact',
      'sold',
      'previous_client',
      'dead',
    ])
    .default('researching'),
  company_phone: z.string().max(50).optional(),
  company_email: z.string().email().max(200).optional(),
  website: z.string().url().max(500).optional(),
  contact_name: z.string().max(200).optional(),
  contact_email: z.string().email().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  zip: z.string().max(20).optional(),
  category: z.string().max(200).optional(),
  is_nonprofit: z.boolean().optional(),
  assigned_to: z.string().uuid().optional(),
});

function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export async function POST(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const user = authz.user;
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins may create prospects.' },
      { status: 403 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const normalized = normalizePhone(body.company_phone);
  const businessKey = normalized
    ? `phone:${normalized}`
    : `manual-${randomUUID()}`;

  const insert = {
    company_name: body.company_name.trim(),
    tier: body.tier,
    state: body.state,
    company_phone: body.company_phone ?? null,
    company_email: body.company_email ?? null,
    website: body.website ?? null,
    contact_name: body.contact_name ?? null,
    contact_email: body.contact_email ?? null,
    contact_phone: body.contact_phone ?? null,
    address: body.address ?? null,
    zip: body.zip ?? null,
    category: body.category ?? null,
    is_nonprofit: body.is_nonprofit ?? null,
    assigned_to: body.assigned_to ?? null,
    assigned_at: body.assigned_to ? new Date().toISOString() : null,
    source: null,
    created_source: 'manual',
    business_key: businessKey,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospects')
    .insert(insert)
    .select('id,business_key')
    .single();
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'manual prospect insert failed',
      context: { code: error.code, message: error.message },
      userId: user.id,
    });
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(
    { id: data.id, business_key: data.business_key },
    { status: 201 },
  );
}
