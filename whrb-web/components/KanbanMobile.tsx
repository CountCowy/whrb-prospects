'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { STATE_ORDER } from '@/components/StateBadge';
import { TierBadge } from '@/components/TierBadge';
import type { KanbanCard } from '@/components/KanbanBoard';

const STATE_LABELS: Record<string, string> = {
  researching: 'Researching',
  waiting_response: 'Waiting response',
  initial_contact: 'Initial contact',
  ongoing_contact: 'Ongoing contact',
  sold: 'Sold',
  previous_client: 'Previous client',
  dead: 'Dead',
};

export function KanbanMobile({ cards }: { cards: KanbanCard[] }) {
  const router = useRouter();
  const [local, setLocal] = useState<KanbanCard[]>(cards);
  const [active, setActive] = useState<string>(STATE_ORDER[0]);
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = local.filter((c) => c.state === active);

  async function changeState(cardId: string, next: string) {
    const row = local.find((c) => c.id === cardId);
    if (!row || row.state === next) return;
    const prev = row.state;
    setLocal((rows) => rows.map((r) => (r.id === cardId ? { ...r, state: next } : r)));
    setPendingCard(cardId);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${cardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: { state: next } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Could not move card.`);
        setLocal((rows) => rows.map((r) => (r.id === cardId ? { ...r, state: prev } : r)));
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setPendingCard(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="kanban-mobile">
      <div
        role="tablist"
        aria-label="Kanban state"
        className="flex gap-2 overflow-x-auto pb-1"
        data-testid="kanban-mobile-pills"
      >
        {STATE_ORDER.map((state) => {
          const count = local.filter((c) => c.state === state).length;
          const isActive = state === active;
          return (
            <button
              key={state}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(state)}
              data-testid={`kanban-mobile-pill-${state}`}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {STATE_LABELS[state] ?? state} ({count})
            </button>
          );
        })}
      </div>
      {error ? (
        <p
          data-testid="kanban-mobile-error"
          className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <div
          data-testid="kanban-mobile-empty"
          className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 text-center text-sm text-[hsl(var(--muted-foreground))]"
        >
          No prospects in {STATE_LABELS[active] ?? active}.
        </div>
      ) : (
        <ul
          className="divide-y divide-[hsl(var(--border-subtle))] overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]"
          data-testid="kanban-mobile-list"
        >
          {visible.map((card) => (
            <li key={card.id} className="p-3" data-testid="kanban-mobile-card" data-card-id={card.id}>
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/prospects/${card.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline"
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
              <label className="mt-2 block text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Move to
              </label>
              <select
                className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm disabled:opacity-50"
                value={card.state}
                onChange={(e) => changeState(card.id, e.target.value)}
                disabled={pendingCard === card.id}
                data-testid={`kanban-mobile-select-${card.id}`}
              >
                {STATE_ORDER.map((state) => (
                  <option key={state} value={state}>
                    {STATE_LABELS[state] ?? state}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
