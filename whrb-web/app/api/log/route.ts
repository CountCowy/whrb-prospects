import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/logging/server';

const ALLOWED_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
type Level = (typeof ALLOWED_LEVELS)[number];

function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (ALLOWED_LEVELS as readonly string[]).includes(v);
}

export async function POST(request: NextRequest) {
  let body: {
    level?: unknown;
    category?: unknown;
    message?: unknown;
    context?: unknown;
    url?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { level, category, message, context, url } = body;
  if (!isLevel(level) || typeof category !== 'string' || typeof message !== 'string') {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await logEvent({
    source: 'web_client',
    level,
    category,
    message,
    context:
      context && typeof context === 'object' ? (context as Record<string, unknown>) : {},
    userId: user?.id ?? null,
    url: typeof url === 'string' ? url : null,
  });

  return NextResponse.json({ ok: true });
}
