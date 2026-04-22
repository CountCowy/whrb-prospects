'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import type { Prospect } from '@/lib/queries/prospects';
import type { NoteView } from '@/components/NotesPanel';
import type { ActivityEntry } from '@/lib/queries/activity';
import { TierBadge } from '@/components/TierBadge';
import { StateBadge, STATE_ORDER } from '@/components/StateBadge';
import { formatDateTime } from '@/lib/time';
import { FieldEditor } from '@/components/FieldEditor';
import { AssignPicker, type AssignProfile } from '@/components/AssignPicker';
import { NotesPanel } from '@/components/NotesPanel';
import { ActivityTab } from '@/components/ActivityTab';
import { PresenceChips } from '@/components/PresenceChips';

type Tab = 'fields' | 'notes' | 'activity';

// UI lock icons are rendered for these 15 fields... minus priority_score
// (audit-tracked but intentionally no icon per §16.3 round-3 item 10).
const LOCK_UI_FIELDS = new Set([
  'tier',
  'company_name',
  'company_phone',
  'company_email',
  'contact_name',
  'contact_email',
  'contact_phone',
  'website',
  'is_nonprofit',
  'address',
  'zip',
  'category',
]);

function isFieldLocked(
  overrides: Record<string, unknown> | null | undefined,
  field: string,
): boolean {
  if (!overrides) return false;
  return Boolean(overrides[field]);
}

export type ProspectDetailProps = {
  prospect: Prospect;
  notes: NoteView[];
  activity: ActivityEntry[];
  profiles: AssignProfile[];
  profileLabels: Record<string, string>;
  currentUserId: string;
  currentUser: { id: string; email: string; display_name: string | null };
  isAdmin: boolean;
};

export function ProspectDetail({
  prospect,
  notes,
  activity,
  profiles,
  profileLabels,
  currentUserId,
  currentUser,
  isAdmin,
}: ProspectDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('fields');
  const [, startTransition] = useTransition();

  const overrides = prospect.user_overrides as Record<string, unknown> | null | undefined;
  const editable = useMemo(() => {
    return isAdmin || prospect.assigned_to === currentUserId;
  }, [isAdmin, prospect.assigned_to, currentUserId]);

  const refresh = () => startTransition(() => router.refresh());

  const assigneeProfile: AssignProfile | null = prospect.assignee
    ? {
        id: prospect.assignee.id,
        email: prospect.assignee.email,
        display_name: prospect.assignee.display_name,
      }
    : null;

  return (
    <div className="space-y-6" data-testid="prospect-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/prospects"
          className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          ← All Prospects
        </Link>
        <span
          data-testid="stage-badge"
          className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--primary))]"
        >
          Stage 7 · Editable
        </span>
      </div>

      <header className="space-y-3 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {prospect.company_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <TierBadge tier={prospect.tier} />
              <StateBadge state={prospect.state} />
            </div>
          </div>
          <PresenceChips prospectId={prospect.id} currentUser={currentUser} />
        </div>
        <AssignPicker
          prospectId={prospect.id}
          currentAssignee={assigneeProfile}
          currentUserId={currentUserId}
          profiles={profiles}
        />
        <StateSelect
          prospectId={prospect.id}
          current={prospect.state}
          editable={editable}
          onChanged={refresh}
        />
      </header>

      <nav role="tablist" aria-label="Detail tabs" className="flex gap-2" data-testid="detail-tabs">
        {(['fields', 'notes', 'activity'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`tab-${key}`}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            }`}
          >
            {key === 'fields' ? 'Fields' : key === 'notes' ? 'Notes' : 'Activity'}
          </button>
        ))}
      </nav>

      {tab === 'fields' ? (
        <section
          className="grid gap-4 lg:grid-cols-2"
          data-testid="detail-fields"
        >
          <Panel title="Company">
            <FieldEditor
              prospectId={prospect.id}
              field="company_name"
              label="Company name"
              value={prospect.company_name}
              editable={editable}
              locked={isFieldLocked(overrides, 'company_name')}
              showLockIcon={LOCK_UI_FIELDS.has('company_name')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="category"
              label="Category"
              value={prospect.category}
              editable={editable}
              locked={isFieldLocked(overrides, 'category')}
              showLockIcon={LOCK_UI_FIELDS.has('category')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="source"
              label="Source"
              value={prospect.source}
              editable={editable}
              locked={isFieldLocked(overrides, 'source')}
              showLockIcon={false}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="website"
              label="Website"
              value={prospect.website}
              inputType="url"
              editable={editable}
              locked={isFieldLocked(overrides, 'website')}
              showLockIcon={LOCK_UI_FIELDS.has('website')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="company_phone"
              label="Company phone"
              value={prospect.company_phone}
              inputType="tel"
              editable={editable}
              locked={isFieldLocked(overrides, 'company_phone')}
              showLockIcon={LOCK_UI_FIELDS.has('company_phone')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="company_email"
              label="Company email"
              value={prospect.company_email}
              inputType="email"
              editable={editable}
              locked={isFieldLocked(overrides, 'company_email')}
              showLockIcon={LOCK_UI_FIELDS.has('company_email')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="address"
              label="Address"
              value={prospect.address}
              editable={editable}
              locked={isFieldLocked(overrides, 'address')}
              showLockIcon={LOCK_UI_FIELDS.has('address')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="zip"
              label="ZIP"
              value={prospect.zip}
              editable={editable}
              locked={isFieldLocked(overrides, 'zip')}
              showLockIcon={LOCK_UI_FIELDS.has('zip')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="tier"
              label="Tier"
              value={prospect.tier}
              editable={editable}
              locked={isFieldLocked(overrides, 'tier')}
              showLockIcon={LOCK_UI_FIELDS.has('tier')}
              onSaved={refresh}
            />
          </Panel>

          <Panel title="Primary contact">
            <FieldEditor
              prospectId={prospect.id}
              field="contact_name"
              label="Contact name"
              value={prospect.contact_name}
              editable={editable}
              locked={isFieldLocked(overrides, 'contact_name')}
              showLockIcon={LOCK_UI_FIELDS.has('contact_name')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="contact_title"
              label="Contact title"
              value={prospect.contact_title}
              editable={editable}
              locked={isFieldLocked(overrides, 'contact_title')}
              showLockIcon={false}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="contact_phone"
              label="Contact phone"
              value={prospect.contact_phone}
              inputType="tel"
              editable={editable}
              locked={isFieldLocked(overrides, 'contact_phone')}
              showLockIcon={LOCK_UI_FIELDS.has('contact_phone')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="contact_email"
              label="Contact email"
              value={prospect.contact_email}
              inputType="email"
              editable={editable}
              locked={isFieldLocked(overrides, 'contact_email')}
              showLockIcon={LOCK_UI_FIELDS.has('contact_email')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="contact_linkedin"
              label="LinkedIn"
              value={prospect.contact_linkedin}
              editable={editable}
              locked={isFieldLocked(overrides, 'contact_linkedin')}
              showLockIcon={false}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="sales_email"
              label="Sales email"
              value={prospect.sales_email}
              inputType="email"
              editable={editable}
              locked={isFieldLocked(overrides, 'sales_email')}
              showLockIcon={false}
              onSaved={refresh}
            />
          </Panel>

          <Panel title="Nonprofit" className="lg:col-span-2">
            <FieldEditor
              prospectId={prospect.id}
              field="is_nonprofit"
              label="Is nonprofit"
              value={
                prospect.is_nonprofit === null || prospect.is_nonprofit === undefined
                  ? null
                  : prospect.is_nonprofit
                    ? 'true'
                    : 'false'
              }
              editable={editable}
              locked={isFieldLocked(overrides, 'is_nonprofit')}
              showLockIcon={LOCK_UI_FIELDS.has('is_nonprofit')}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="nonprofit_source"
              label="Nonprofit source"
              value={prospect.nonprofit_source}
              editable={editable}
              locked={isFieldLocked(overrides, 'nonprofit_source')}
              showLockIcon={false}
              onSaved={refresh}
            />
            <FieldEditor
              prospectId={prospect.id}
              field="ein"
              label="EIN"
              value={prospect.ein}
              editable={editable}
              locked={isFieldLocked(overrides, 'ein')}
              showLockIcon={false}
              onSaved={refresh}
            />
          </Panel>

          <Panel title="Pipeline data" className="lg:col-span-2">
            <ReadOnlyField label="Priority score" value={prospect.priority_score} />
            <ReadOnlyField label="Rating" value={prospect.rating} />
            <ReadOnlyField label="Reviews" value={prospect.review_count} />
            <ReadOnlyField label="Seasonality" value={prospect.seasonality_window} />
            <ReadOnlyField label="Business key" value={prospect.business_key} />
            <ReadOnlyField
              label="Pipeline last seen"
              value={
                prospect.pipeline_last_seen_at
                  ? formatDateTime(prospect.pipeline_last_seen_at)
                  : null
              }
            />
            <ReadOnlyField label="Created" value={formatDateTime(prospect.created_at)} />
            <ReadOnlyField label="Created source" value={prospect.created_source} />
            <ReadOnlyField label="Pipeline notes" value={prospect.pipeline_notes} />
          </Panel>
        </section>
      ) : null}

      {tab === 'notes' ? (
        <NotesPanel
          prospectId={prospect.id}
          initialNotes={notes}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          authorLabels={profileLabels}
        />
      ) : null}

      {tab === 'activity' ? (
        <ActivityTab entries={activity} profiles={profileLabels} isAdmin={isAdmin} />
      ) : null}
    </div>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)] ${
        className ?? ''
      }`}
    >
      <h2 className="mb-2 text-base font-semibold tracking-tight">{title}</h2>
      <dl className="divide-y divide-[hsl(var(--border-subtle))]">{children}</dl>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="grid grid-cols-3 items-baseline gap-3 py-2">
      <dt className="col-span-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="col-span-2 break-words text-sm text-[hsl(var(--foreground))]">
        {value === null || value === undefined || value === '' ? (
          <span className="text-[hsl(var(--muted-foreground))]">—</span>
        ) : (
          String(value)
        )}
      </dd>
    </div>
  );
}

function StateSelect({
  prospectId,
  current,
  editable,
  onChanged,
}: {
  prospectId: string;
  current: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(next: string) {
    if (next === current) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/prospects/${prospectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { state: next } }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Could not change state.');
      return;
    }
    onChanged();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="state-picker">
      <span className="text-[hsl(var(--muted-foreground))]">State:</span>
      <select
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm disabled:opacity-50"
        value={current}
        onChange={(e) => change(e.target.value)}
        disabled={!editable || pending}
        data-testid="state-select"
      >
        {STATE_ORDER.map((state) => (
          <option key={state} value={state}>
            {state.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-xs text-red-600 dark:text-red-300" data-testid="state-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
