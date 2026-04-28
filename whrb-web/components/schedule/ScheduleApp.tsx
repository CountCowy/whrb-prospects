'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { formatInTz } from '@/lib/time';
import type { ScheduleEvent } from '@/lib/queries/schedule';
import type { ScheduleCategory } from '@/styles/schedule-colors';
import { ScheduleHeader } from '@/components/schedule/ScheduleHeader';
import { MonthView } from '@/components/schedule/MonthView';
import { AgendaView } from '@/components/schedule/AgendaView';
import { CreateEventDialog } from '@/components/schedule/CreateEventDialog';
import { EventDetailDialog } from '@/components/schedule/EventDetailDialog';

export type RosterUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'rep';
};

export type ScheduleAppProps = {
  initialEvents: ScheduleEvent[];
  currentUser: { id: string; email: string; role: 'admin' | 'rep' };
  profiles: RosterUser[];
  view: 'month' | 'agenda';
  anchorIso: string;
  scope: 'mine' | 'team' | 'all';
  categories: ScheduleCategory[];
};

export function ScheduleApp({
  initialEvents,
  currentUser,
  profiles,
  view,
  anchorIso,
  scope,
  categories,
}: ScheduleAppProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const [events, setEvents] = useState<ScheduleEvent[]>(initialEvents);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{
    starts_at?: string;
    prospect_id?: string | null;
    mode?: 'event' | 'task';
  }>({});
  const [detailEvent, setDetailEvent] = useState<ScheduleEvent | null>(null);

  // Track the latest navigation (URL-driven) so realtime updates that
  // arrive between renders survive. We replace local state from props
  // ONLY when the server-side window changes — not on every render.
  const lastSeenInitialRef = useRef(initialEvents);
  useEffect(() => {
    if (lastSeenInitialRef.current !== initialEvents) {
      lastSeenInitialRef.current = initialEvents;
      setEvents(initialEvents);
    }
  }, [initialEvents]);

  // Realtime: schedule_events INSERT/UPDATE/DELETE. The handler is the
  // sole authority for state during a session — mutation handlers (create
  // / update / delete) no longer call router.refresh(), which previously
  // stomped in-flight realtime events.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('schedule:all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedule_events' },
        async (payload) => {
          const type = payload.eventType;
          if (type === 'INSERT' || type === 'UPDATE') {
            const row = payload.new as ScheduleEvent;
            const detailRes = await fetch(
              `/api/schedule/events/${encodeURIComponent(row.id)}`,
            ).catch(() => null);
            if (!detailRes?.ok) return;
            const fresh = (await detailRes.json()) as ScheduleEvent;
            setEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === fresh.id);
              if (idx === -1) return [...prev, fresh];
              const next = prev.slice();
              next[idx] = fresh;
              return next;
            });
          } else if (type === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (oldId) setEvents((prev) => prev.filter((e) => e.id !== oldId));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const setUrl = useCallback(
    (next: Partial<{ view: string; date: string; scope: string; category: string }>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === '' || v == null) params.delete(k);
        else params.set(k, v);
      }
      router.replace(`/schedule?${params.toString()}`);
    },
    [router, sp],
  );

  // Helper: pull the row back from the server and reconcile local state.
  // We use this in the mutation handlers as a defense-in-depth on top of
  // the realtime channel — realtime can lag or drop, so a single targeted
  // fetch keeps the dialog in sync with what was actually saved.
  const reconcileById = useCallback(async (id: string) => {
    const res = await fetch(`/api/schedule/events/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const fresh = (await res.json()) as ScheduleEvent;
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === fresh.id);
      if (idx === -1) return [...prev, fresh];
      const next = prev.slice();
      next[idx] = fresh;
      return next;
    });
  }, []);

  const onCreate = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/schedule/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Could not create event.');
        return false;
      }
      toast.success('Event created.');
      const body = (await res.json().catch(() => null)) as
        | { ids?: string[] }
        | null;
      for (const id of body?.ids ?? []) {
        await reconcileById(id);
      }
      return true;
    },
    [reconcileById],
  );

  const onUpdate = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const res = await fetch(`/api/schedule/events/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Update failed.');
        return false;
      }
      toast.success('Saved.');
      const body = (await res.json().catch(() => null)) as
        | { ids?: string[] }
        | null;
      for (const updatedId of body?.ids ?? [id]) {
        await reconcileById(updatedId);
      }
      return true;
    },
    [reconcileById],
  );

  const onDelete = useCallback(
    async (id: string, series: boolean) => {
      const res = await fetch(
        `/api/schedule/events/${encodeURIComponent(id)}${series ? '?series=true' : ''}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Delete failed.');
        return false;
      }
      toast.success('Deleted.');
      setDetailEvent(null);
      const body = (await res.json().catch(() => null)) as
        | { ids?: string[] }
        | null;
      const removed = new Set(body?.ids ?? [id]);
      setEvents((prev) => prev.filter((e) => !removed.has(e.id)));
      return true;
    },
    [],
  );

  const anchor = useMemo(() => new Date(anchorIso), [anchorIso]);

  return (
    <div data-testid="schedule-app" className="space-y-4">
      <ScheduleHeader
        view={view}
        anchor={anchor}
        scope={scope}
        categories={categories}
        onChangeView={(v) => setUrl({ view: v })}
        // Encode the anchor as the user's ET wall-clock day, not UTC —
        // otherwise picking "today" late at night ET sends tomorrow's
        // date to the server and the next render's window is wrong.
        onChangeAnchor={(d) => setUrl({ date: formatInTz(d, 'yyyy-MM-dd') })}
        onChangeScope={(s) => setUrl({ scope: s })}
        onChangeCategories={(c) => setUrl({ category: c.join(',') })}
        onCreateClick={() => {
          setCreateDefaults({});
          setCreateOpen(true);
        }}
      />

      {view === 'month' ? (
        <MonthView
          anchor={anchor}
          events={events}
          onSelectDay={(d) => {
            setCreateDefaults({ starts_at: d.toISOString() });
            setCreateOpen(true);
          }}
          onSelectEvent={(e) => setDetailEvent(e)}
        />
      ) : (
        <AgendaView events={events} onSelectEvent={(e) => setDetailEvent(e)} />
      )}

      <CreateEventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        currentUser={currentUser}
        profiles={profiles}
        defaults={createDefaults}
        onSubmit={onCreate}
      />
      <EventDetailDialog
        event={detailEvent}
        open={detailEvent != null}
        onOpenChange={(o) => !o && setDetailEvent(null)}
        currentUser={currentUser}
        profiles={profiles}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </div>
  );
}
