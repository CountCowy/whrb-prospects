'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { BulkPreviewTable } from './BulkPreviewTable';
import type {
  Action,
  Assignee,
  Filter,
  MatchedRow,
  SelectionMode,
} from './BulkActionsForm.types';

const STATE_OPTIONS = [
  'researching',
  'waiting_response',
  'initial_contact',
  'ongoing_contact',
  'sold',
  'previous_client',
  'dead',
] as const;

const DEFAULT_PAGE_SIZE = 25;

function blankFilter(): Filter {
  return {};
}

type PreviewResponse = {
  ok: boolean;
  count: number;
  ids: string[];
  rows: MatchedRow[];
  page: number;
  pageSize: number;
  countExceeded: boolean;
};

export function BulkActionsForm({ assignees }: { assignees: Assignee[] }) {
  const assigneesById = useMemo(() => {
    const m = new Map<string, Assignee>();
    for (const a of assignees) m.set(a.id, a);
    return m;
  }, [assignees]);

  // Filter + preview state
  const [filter, setFilter] = useState<Filter>(blankFilter());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Action state
  const [action, setAction] = useState<Action>('assign');
  const [assignTo, setAssignTo] = useState<string>('');
  const [stateValue, setStateValue] = useState<(typeof STATE_OPTIONS)[number]>('researching');
  const [tierValue, setTierValue] = useState<'A' | 'B' | 'C'>('A');
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();

  // Stage 10c: selection mode + exclusion (filter mode) / basket (selection mode).
  const [mode, setMode] = useState<SelectionMode>('filter');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [basket, setBasket] = useState<Set<string>>(new Set());

  function setField<K extends keyof Filter>(k: K, v: Filter[K]) {
    setFilter((f) => {
      const next = { ...f };
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
      return next;
    });
    setPreview(null);
    setPage(0);
    setExcluded(new Set());
  }

  async function runPreview(opts?: { page?: number; pageSize?: number }): Promise<PreviewResponse | null> {
    const p = opts?.page ?? page;
    const ps = opts?.pageSize ?? pageSize;
    try {
      const res = await fetch('/api/admin/prospects/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter,
          preview: true,
          page: p,
          pageSize: ps,
          action: 'state',
          payload: { state: 'researching' },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Preview failed.');
        return null;
      }
      const body = (await res.json()) as PreviewResponse;
      setPreview(body);
      setPage(body.page);
      setPageSize(body.pageSize);
      return body;
    } catch (err) {
      toast.error(`Preview failed: ${(err as Error).message}`);
      return null;
    }
  }

  function onPreviewClick() {
    setExcluded(new Set());
    startTransition(async () => {
      await runPreview({ page: 0 });
    });
  }

  function onPageChange(p: number) {
    startTransition(async () => {
      await runPreview({ page: p });
    });
  }

  function onPageSizeChange(ps: number) {
    startTransition(async () => {
      await runPreview({ page: 0, pageSize: ps });
    });
  }

  function toggleRowExclude(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRowBasket(id: string) {
    setBasket((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onToggleRow(id: string) {
    if (mode === 'filter') toggleRowExclude(id);
    else toggleRowBasket(id);
  }

  function addPageToBasket() {
    if (!preview) return;
    setBasket((prev) => {
      const next = new Set(prev);
      for (const r of preview.rows) next.add(r.id);
      return next;
    });
  }

  function addAllMatchesToBasket() {
    if (!preview) return;
    setBasket((prev) => {
      const next = new Set(prev);
      for (const id of preview.ids) next.add(id);
      return next;
    });
  }

  function clearBasket() {
    setBasket(new Set());
  }

  const effectiveCount = useMemo(() => {
    if (mode === 'basket') return basket.size;
    if (!preview) return null;
    const excludedInMatches = preview.ids.filter((id) => excluded.has(id)).length;
    return Math.max(0, preview.count - excludedInMatches);
  }, [mode, preview, excluded, basket]);

  async function apply() {
    if (mode === 'filter') {
      if (!preview) {
        toast.error('Run preview first.');
        return;
      }
      if (effectiveCount === 0) {
        toast.error('No rows match after exclusions.');
        return;
      }
      if (preview.countExceeded) {
        toast.error('Narrow the filter — match set exceeds 5,000.');
        return;
      }
    } else {
      if (basket.size === 0) {
        toast.error('Basket is empty. Add rows via preview first.');
        return;
      }
    }
    if (action === 'delete' && confirmText !== 'DELETE') {
      toast.error('Type DELETE to confirm.');
      return;
    }

    let payload: Record<string, unknown>;
    if (action === 'assign') payload = { assigned_to: assignTo || null };
    else if (action === 'state') payload = { state: stateValue };
    else if (action === 'tier') payload = { tier: tierValue };
    else payload = { confirm: 'DELETE' };

    startTransition(async () => {
      let reqBody: Record<string, unknown>;
      if (mode === 'basket') {
        reqBody = { ids: Array.from(basket), action, payload };
      } else {
        // Filter-based apply with exclusions — send explicit ids when any row
        // is excluded; otherwise use the legacy filter body.
        const includedIds = (preview?.ids ?? []).filter((id) => !excluded.has(id));
        if (excluded.size > 0) {
          reqBody = { ids: includedIds, action, payload };
        } else {
          reqBody = { filter, action, payload };
        }
      }
      const res = await fetch('/api/admin/prospects/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Action failed.');
        return;
      }
      const body = (await res.json()) as { count: number; action: Action; via?: string };
      toast.success(
        `Applied ${body.action} to ${body.count} prospect${body.count === 1 ? '' : 's'}${body.via === 'ids' ? ' (selection)' : ''}.`,
      );
      setConfirmText('');
      if (mode === 'basket') {
        setBasket(new Set());
      } else {
        setExcluded(new Set());
        setPreview(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Filter</h2>
          <div
            className="flex gap-1 rounded-md border border-[hsl(var(--border))] p-0.5 text-xs"
            role="tablist"
            aria-label="Selection mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'filter'}
              data-testid="bulk-mode-filter"
              onClick={() => setMode('filter')}
              className={`rounded px-2 py-1 font-medium ${
                mode === 'filter'
                  ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
              }`}
            >
              Filter-based
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'basket'}
              data-testid="bulk-mode-basket"
              onClick={() => setMode('basket')}
              className={`rounded px-2 py-1 font-medium ${
                mode === 'basket'
                  ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
              }`}
            >
              Selection-based
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LabeledInput
            label="Search (q)"
            value={filter.q ?? ''}
            onChange={(v) => setField('q', v)}
            placeholder="name / email / phone…"
            testId="bulk-filter-q"
          />
          <LabeledSelect
            label="Tier"
            value={filter.tier ?? ''}
            onChange={(v) => setField('tier', (v || undefined) as Filter['tier'])}
            testId="bulk-filter-tier"
            options={[
              { value: '', label: '(any)' },
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
              { value: 'C', label: 'C' },
            ]}
          />
          <LabeledSelect
            label="State"
            value={filter.state ?? ''}
            onChange={(v) => setField('state', (v || undefined) as Filter['state'])}
            testId="bulk-filter-state"
            options={[
              { value: '', label: '(any)' },
              ...STATE_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })),
            ]}
          />
          <LabeledInput
            label="Category (ilike)"
            value={filter.category ?? ''}
            onChange={(v) => setField('category', v)}
            placeholder="landscap%"
            testId="bulk-filter-category"
          />
          <LabeledSelect
            label="Assigned"
            value={filter.assigned ?? ''}
            onChange={(v) => setField('assigned', (v || undefined) as Filter['assigned'])}
            options={[
              { value: '', label: '(any)' },
              { value: 'true', label: 'Assigned' },
              { value: 'false', label: 'Unassigned' },
            ]}
          />
          <LabeledSelect
            label="Nonprofit"
            value={filter.is_nonprofit ?? ''}
            onChange={(v) => setField('is_nonprofit', (v || undefined) as Filter['is_nonprofit'])}
            options={[
              { value: '', label: '(any)' },
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]}
          />
          <LabeledInput label="ZIP" value={filter.zip ?? ''} onChange={(v) => setField('zip', v)} />
          <LabeledInput label="Source" value={filter.source ?? ''} onChange={(v) => setField('source', v)} />
          <LabeledSelect
            label="Assignee"
            value={filter.assigned_to ?? ''}
            onChange={(v) => setField('assigned_to', v || undefined)}
            options={[
              { value: '', label: '(any)' },
              ...assignees.map((a) => ({
                value: a.id,
                label: a.label + (a.deactivated ? ' (inactive)' : ''),
              })),
            ]}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPreviewClick}
            disabled={pending}
            className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            data-testid="bulk-preview"
          >
            {pending ? 'Loading…' : 'Preview'}
          </button>
          {preview ? (
            <span className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="bulk-preview-count">
              {preview.count.toLocaleString()} match{preview.count === 1 ? '' : 'es'}
            </span>
          ) : null}
          {mode === 'basket' && preview ? (
            <>
              <button
                type="button"
                onClick={addPageToBasket}
                data-testid="bulk-basket-add-page"
                disabled={pending}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                + Add this page ({preview.rows.length})
              </button>
              <button
                type="button"
                onClick={addAllMatchesToBasket}
                data-testid="bulk-basket-add-all"
                disabled={pending || preview.countExceeded}
                title={preview.countExceeded ? 'Match set exceeds 5,000 — narrow filter first.' : undefined}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                + Add all matches ({preview.ids.length})
              </button>
            </>
          ) : null}
        </div>
      </section>

      {mode === 'basket' ? (
        <section
          className="rounded-xl border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] p-4 shadow-sm"
          data-testid="bulk-basket-strip"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[hsl(var(--primary))]">
                Selection basket
              </h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Selected (<span data-testid="bulk-basket-count">{basket.size}</span>) — survives
                filter changes until Clear.
              </p>
            </div>
            <button
              type="button"
              onClick={clearBasket}
              data-testid="bulk-basket-clear"
              disabled={basket.size === 0}
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            >
              Clear basket
            </button>
          </div>
        </section>
      ) : null}

      {preview ? (
        <BulkPreviewTable
          rows={preview.rows}
          page={preview.page}
          pageSize={preview.pageSize}
          total={preview.count}
          countExceeded={preview.countExceeded}
          excluded={mode === 'filter' ? excluded : new Set(preview.rows.map((r) => r.id).filter((id) => !basket.has(id)))}
          onToggleRow={onToggleRow}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          mode={mode}
          basketSize={basket.size}
          assigneesById={assigneesById}
        />
      ) : null}

      <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Action</h2>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Bulk action">
            {(['assign', 'state', 'tier', 'delete'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={action === a}
                onClick={() => setAction(a)}
                data-testid={`bulk-action-${a}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  action === a
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
          {action === 'assign' ? (
            <LabeledSelect
              label="Assign to"
              value={assignTo}
              onChange={setAssignTo}
              testId="bulk-action-assign-to"
              options={[
                { value: '', label: '(unassign)' },
                ...assignees
                  .filter((a) => !a.deactivated)
                  .map((a) => ({ value: a.id, label: a.label })),
              ]}
            />
          ) : null}
          {action === 'state' ? (
            <LabeledSelect
              label="New state"
              value={stateValue}
              onChange={(v) => setStateValue(v as (typeof STATE_OPTIONS)[number])}
              testId="bulk-action-state-value"
              options={STATE_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
            />
          ) : null}
          {action === 'tier' ? (
            <LabeledSelect
              label="New tier"
              value={tierValue}
              onChange={(v) => setTierValue(v as 'A' | 'B' | 'C')}
              testId="bulk-action-tier-value"
              options={[
                { value: 'A', label: 'A' },
                { value: 'B', label: 'B' },
                { value: 'C', label: 'C' },
              ]}
            />
          ) : null}
          {action === 'delete' ? (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-red-600">
                Confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE to enable the button"
                data-testid="bulk-delete-confirm"
                className="mt-1 w-full rounded-md border border-red-300 bg-[hsl(var(--background))] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
          ) : null}
          <button
            type="button"
            onClick={apply}
            disabled={
              pending ||
              (mode === 'filter' && (!preview || effectiveCount === 0)) ||
              (mode === 'basket' && basket.size === 0) ||
              (action === 'delete' && confirmText !== 'DELETE')
            }
            data-testid="bulk-apply"
            className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              action === 'delete'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[hsl(var(--primary))] hover:opacity-90'
            }`}
          >
            {action === 'delete'
              ? `Delete ${effectiveCount ?? 0} prospect${effectiveCount === 1 ? '' : 's'} (irreversible)`
              : `Apply to ${effectiveCount ?? 0}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
