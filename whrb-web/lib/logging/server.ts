import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogSource = 'web_server' | 'web_client';

export interface LogEventInput {
  source: LogSource;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
  userId?: string | null;
  url?: string | null;
  httpStatus?: number | null;
}

export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('event_log').insert({
      source: input.source,
      level: input.level,
      category: input.category,
      message: input.message,
      context: input.context ?? {},
      user_id: input.userId ?? null,
      url: input.url ?? null,
      http_status: input.httpStatus ?? null,
    });
  } catch (err) {
    console.error('[logEvent] failed to insert event_log row', err);
  }
}
