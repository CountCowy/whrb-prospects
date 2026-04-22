'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Participant = {
  user_id: string;
  email: string;
  display_name: string | null;
  joined_at: number;
};

const HEARTBEAT_MS = 30_000;

function initials(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  if (trimmed.includes('@')) {
    return trimmed.slice(0, 2).toUpperCase();
  }
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function PresenceChips({
  prospectId,
  currentUser,
}: {
  prospectId: string;
  currentUser: { id: string; email: string; display_name: string | null };
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const supabase = createClient();

    const channel = supabase.channel(`prospect:${prospectId}`, {
      config: { presence: { key: currentUser.id } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      if (!mounted.current) return;
      const state = channel.presenceState() as Record<string, Array<Partial<Participant>>>;
      const next: Participant[] = [];
      for (const [userId, metas] of Object.entries(state)) {
        const m = metas[0];
        if (!m) continue;
        next.push({
          user_id: (m.user_id as string) ?? userId,
          email: (m.email as string) ?? '',
          display_name: (m.display_name as string | null) ?? null,
          joined_at: (m.joined_at as number) ?? Date.now(),
        });
      }
      next.sort((a, b) => a.joined_at - b.joined_at);
      setParticipants(next);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: currentUser.id,
          email: currentUser.email,
          display_name: currentUser.display_name,
          joined_at: Date.now(),
        });
      }
    });

    // Table-based heartbeat — backs the kanban green-dot query.
    const sendHeartbeat = () => {
      void fetch(`/api/prospects/${prospectId}/presence`, {
        method: 'POST',
        credentials: 'same-origin',
      }).catch(() => {});
    };
    sendHeartbeat();
    const iv = setInterval(sendHeartbeat, HEARTBEAT_MS);

    return () => {
      mounted.current = false;
      clearInterval(iv);
      void channel.untrack().then(() => supabase.removeChannel(channel));
    };
  }, [prospectId, currentUser.id, currentUser.email, currentUser.display_name]);

  // Only surface OTHER viewers. A user alone on a page shouldn't see a
  // "Viewing" chip for themselves — it's visual clutter and users on
  // iOS read it as an avatar decoration stuck on the title.
  const others = participants.filter((p) => p.user_id !== currentUser.id);
  if (others.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5"
      aria-label="Other viewers"
      data-testid="presence-chips"
      data-count={others.length}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Viewing
      </span>
      <div className="flex -space-x-1.5">
        {others.slice(0, 5).map((p) => {
          const label = p.display_name?.trim() || p.email;
          return (
            <span
              key={p.user_id}
              title={label}
              data-testid="presence-chip"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[hsl(var(--background))] bg-[hsl(var(--muted))] text-[10px] font-semibold text-[hsl(var(--foreground))]"
            >
              {initials(label)}
            </span>
          );
        })}
        {others.length > 5 ? (
          <span className="inline-flex h-7 items-center justify-center rounded-full border-2 border-[hsl(var(--background))] bg-[hsl(var(--muted))] px-2 text-[10px] font-semibold text-[hsl(var(--foreground))]">
            +{others.length - 5}
          </span>
        ) : null}
      </div>
    </div>
  );
}
