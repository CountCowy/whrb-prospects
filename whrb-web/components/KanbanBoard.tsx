'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
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

export type KanbanCard = {
  id: string;
  company_name: string;
  tier: string | null;
  state: string;
  priority_score: number | null;
};

const STATE_LABELS: Record<string, string> = {
  researching: 'Researching',
  waiting_response: 'Waiting response',
  initial_contact: 'Initial contact',
  ongoing_contact: 'Ongoing contact',
  sold: 'Sold',
  previous_client: 'Previous client',
  dead: 'Dead',
};

type KanbanProps = {
  cards: KanbanCard[];
};

export function KanbanBoard({ cards }: KanbanProps) {
  const router = useRouter();
  const [local, setLocal] = useState<KanbanCard[]>(cards);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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
}: {
  state: string;
  cards: KanbanCard[];
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
          <KanbanCardView key={card.id} card={card} />
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

function KanbanCardView({ card }: { card: KanbanCard }) {
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
        {card.tier ? <TierBadge tier={card.tier} /> : null}
      </div>
      {card.priority_score !== null && card.priority_score !== undefined ? (
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          score {card.priority_score}
        </p>
      ) : null}
    </div>
  );
}
