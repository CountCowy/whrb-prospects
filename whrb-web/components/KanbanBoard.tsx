'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  MouseSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { STATE_ORDER } from '@/components/StateBadge';
import { TierBadge } from '@/components/TierBadge';
import { createClient } from '@/lib/supabase/client';

export type KanbanCard = {
  id: string;
  company_name: string;
  tier: string | null;
  state: string;
  priority_score: number | null;
};

type PresenceMap = Record<string, number>;

const STATE_LABELS: Record<string, string> = {
  researching: 'Researching',
  waiting_response: 'Waiting response',
  initial_contact: 'Initial contact',
  ongoing_contact: 'Ongoing contact',
  sold: 'Sold',
  previous_client: 'Previous client',
  dead: 'Dead',
};

const PRESENCE_STALE_MS = 90_000;

type KanbanProps = {
  cards: KanbanCard[];
  currentUserId: string;
  initialPresence?: PresenceMap;
};

export function KanbanBoard({ cards, currentUserId, initialPresence = {} }: KanbanProps) {
  const router = useRouter();
  const [local, setLocal] = useState<KanbanCard[]>(cards);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [presenceCount, setPresenceCount] = useState<PresenceMap>(initialPresence);
  // Track the most recent last_seen_at per (prospect_id, user_id) so the
  // stale sweep can drop viewers whose heartbeat lapsed past 90 s.
  const entriesRef = useRef<Map<string, number>>(new Map());

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const cardIds = cards.map((c) => c.id);

  useEffect(() => {
    if (cardIds.length === 0) return;
    const supabase = createClient();
    const cardIdSet = new Set(cardIds);

    const recalc = () => {
      const now = Date.now();
      const counts: PresenceMap = {};
      for (const [key, ts] of entriesRef.current.entries()) {
        if (now - ts > PRESENCE_STALE_MS) {
          entriesRef.current.delete(key);
          continue;
        }
        const prospectId = key.split('|')[0];
        counts[prospectId] = (counts[prospectId] ?? 0) + 1;
      }
      setPresenceCount(counts);
    };

    const apply = (row: { prospect_id?: string; user_id?: string; last_seen_at?: string }) => {
      const pid = row.prospect_id;
      const uid = row.user_id;
      const ts = row.last_seen_at ? Date.parse(row.last_seen_at) : Date.now();
      if (!pid || !uid) return;
      if (!cardIdSet.has(pid)) return;
      if (uid === currentUserId) return;
      entriesRef.current.set(`${pid}|${uid}`, ts);
      recalc();
    };

    const channel = supabase
      .channel('kanban-presence')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'prospect_presence' },
        (payload) => apply(payload.new as never),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'prospect_presence' },
        (payload) => apply(payload.new as never),
      )
      .subscribe();

    const sweep = setInterval(recalc, 15_000);

    return () => {
      clearInterval(sweep);
      void supabase.removeChannel(channel);
    };
  }, [cardIds, currentUserId]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const cardId = String(active.id);
    const targetState = String(over.id);
    const current = local.find((c) => c.id === cardId);
    if (!current || current.state === targetState) return;
    if (!STATE_ORDER.includes(targetState)) return;
    const previousState = current.state;
    setLocal((rows) =>
      rows.map((r) => (r.id === cardId ? { ...r, state: targetState } : r)),
    );
    const res = await fetch(`/api/prospects/${cardId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { state: targetState } }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not move card (status ${res.status}).`);
      setLocal((rows) =>
        rows.map((r) => (r.id === cardId ? { ...r, state: previousState } : r)),
      );
      return;
    }
    setError(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3" data-testid="kanban-board">
      {error ? (
        <p data-testid="kanban-error" className="text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          {STATE_ORDER.map((state) => {
            const columnCards = local.filter((c) => c.state === state);
            return (
              <KanbanColumn
                key={state}
                state={state}
                cards={columnCards}
                presence={presenceCount}
              />
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}

function KanbanColumn({
  state,
  cards,
  presence,
}: {
  state: string;
  cards: KanbanCard[];
  presence: PresenceMap;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: state });
  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-col-${state}`}
      data-over={isOver ? 'true' : 'false'}
      className={`flex min-h-[200px] flex-col rounded-xl border bg-[hsl(var(--surface))] p-3 shadow-[var(--shadow-sm)] ${
        isOver
          ? 'border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))]'
          : 'border-[hsl(var(--border-subtle))]'
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          {STATE_LABELS[state] ?? state}
        </h3>
        <span
          data-testid={`kanban-count-${state}`}
          className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]"
        >
          {cards.length}
        </span>
      </div>
      <div className="space-y-2">
        {cards.map((card) => (
          <KanbanCardView
            key={card.id}
            card={card}
            presentCount={presence[card.id] ?? 0}
          />
        ))}
        {cards.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-[hsl(var(--border))] p-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]"
            data-testid={`kanban-empty-${state}`}
          >
            Drop here
          </p>
        ) : null}
      </div>
    </div>
  );
}

function KanbanCardView({
  card,
  presentCount,
}: {
  card: KanbanCard;
  presentCount: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.4 : 1,
      }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      data-testid="kanban-card"
      data-card-id={card.id}
      data-card-state={card.state}
      data-presence-count={presentCount}
      className="cursor-grab rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] p-2 text-sm shadow-[var(--shadow-sm)] active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/prospects/${card.id}`}
          onClick={(e) => {
            if (isDragging) e.preventDefault();
          }}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
          data-testid="kanban-card-title"
        >
          {card.company_name}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {presentCount > 0 ? (
            <span
              aria-label={`${presentCount} other viewer${presentCount === 1 ? '' : 's'}`}
              title={`${presentCount} other viewer${presentCount === 1 ? '' : 's'}`}
              data-testid="kanban-presence-dot"
              className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_hsl(var(--background))]"
            />
          ) : null}
          {card.tier ? <TierBadge tier={card.tier} /> : null}
        </div>
      </div>
      {card.priority_score !== null && card.priority_score !== undefined ? (
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          score {card.priority_score}
        </p>
      ) : null}
    </div>
  );
}
