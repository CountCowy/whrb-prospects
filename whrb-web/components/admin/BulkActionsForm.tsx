'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

const STATE_OPTIONS = [
  'researching',
  'waiting_response',
  'initial_contact',
  'ongoing_contact',
  'sold',
  'previous_client',
  'dead',
] as const;

type Filter = {
  q?: string;
  tier?: string;
  state?: string;
  assigned_to?: string;
  zip?: string;
  category?: string;
  source?: string;
  is_nonprofit?: 'true' | 'false';
  assigned?: 'true' | 'false';
};

type SampleRow = {
  id: string;
  company_name: string;
  tier: string | null;
  state: string;
  assigned_to: string | null;
};

type Assignee = { id: string; label: string; deactivated: boolean };

type Action = 'assign' | 'state' | 'tier' | 'delete';

function blankFilter(): Filter {
  return {};
}

export function BulkActionsForm({ assignees }: { assignees: Assignee[] }) {
  const [filter, setFilter] = useState<Filter>(blankFilter());
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [sample, setSample] = useState<SampleRow[]>([]);
  const [action, setAction] = useState<Action>('assign');
  const [assignTo, setAssignTo] = useState<string>('');
  const [stateValue, setStateValue] = useState<(typeof STATE_OPTIONS)[number]>('researching');
  const [tierValue, setTierValue] = useState<'A' | 'B' | 'C'>('A');
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();

  function setField<K extends keyof Filter>(k: K, v: Filter[K]) {
    setFilter((f) => {
      const next = { ...f };
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
      return next;
    });
    setPreviewCount(null);
    setSample([]);
  }

  async function preview() {
    startTransition(async () => {
      const res = await fetch('/api/admin/prospects/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter,
          preview: true,
          action: 'state',
          payload: { state: 'researching' },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Preview failed.');
        return;
      }
      const body = (await res.json()) as { count: number; sample: SampleRow[] };
      setPreviewCount(body.count);
      setSample(body.sample);
    });
  }

  async function apply() {
    if (previewCount === null) {
      toast.error('Run preview first.');
      return;
    }
    if (previewCount === 0) {
      toast.error('No rows match the filter.');
      return;
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
      const res = await fetch('/api/admin/prospects/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, action, payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Action failed.');
        return;
      }
      const body = (await res.json()) as { count: number; action: Action };
      toast.success(
        `Applied ${body.action} to ${body.count} prospect${body.count === 1 ? '' : 's'}.`,
      );
      setPreviewCount(null);
      setSample([]);
      setConfirmText('');
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Filter</h2>
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
            onChange={(v) =>
              setField('is_nonprofit', (v || undefined) as Filter['is_nonprofit'])
            }
            options={[
              { value: '', label: '(any)' },
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]}
          />
          <LabeledInput
            label="ZIP"
            value={filter.zip ?? ''}
            onChange={(v) => setField('zip', v)}
          />
          <LabeledInput
            label="Source"
            value={filter.source ?? ''}
            onChange={(v) => setField('source', v)}
          />
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
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={preview}
            disabled={pending}
            className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            data-testid="bulk-preview"
          >
            {pending ? 'Loading…' : 'Preview'}
          </button>
          {previewCount !== null ? (
            <span
              className="text-sm text-[hsl(var(--muted-foreground))]"
              data-testid="bulk-preview-count"
            >
              {previewCount.toLocaleString()} match
              {previewCount === 1 ? '' : 'es'}
            </span>
          ) : null}
        </div>
      </section>

      {sample.length > 0 ? (
        <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Sample (first 10)</h2>
          <ul className="mt-3 divide-y divide-[hsl(var(--border-subtle))] text-sm">
            {sample.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span className="truncate">{r.company_name}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  tier {r.tier ?? '—'} · {r.state}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
              previewCount === null ||
              previewCount === 0 ||
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
              ? `Delete ${previewCount ?? 0} prospects (irreversible)`
              : `Apply to ${previewCount ?? 0}`}
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
