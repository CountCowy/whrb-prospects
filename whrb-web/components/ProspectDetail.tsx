'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type {
  Prospect,
  ProspectContactEmail,
} from '@/lib/queries/prospects';
import type { NoteView } from '@/components/NotesPanel';
import type { ActivityEntry } from '@/lib/queries/activity';
import type { ProspectTagView } from '@/lib/queries/prospect-tags';
import type { VocabRow } from '@/lib/queries/vocab';
import { TierBadge } from '@/components/TierBadge';
import { StateBadge, STATE_ORDER } from '@/components/StateBadge';
import { formatDateTime } from '@/lib/time';
import { FieldEditor } from '@/components/FieldEditor';
import { ContactEmailsEditor } from '@/components/ContactEmailsEditor';
import { AssignPicker, type AssignProfile } from '@/components/AssignPicker';
import { NotesPanel } from '@/components/NotesPanel';
import { ActivityTab } from '@/components/ActivityTab';
import { PresenceChips } from '@/components/PresenceChips';
import { TagChips } from '@/components/TagChips';
import { TagAddDialog } from '@/components/TagAddDialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type Tab = 'fields' | 'notes' | 'activity';

// UI lock icons are rendered for these 15 fields... minus priority_score
// (audit-tracked but intentionally no icon per §16.3 round-3 item 10).
// `contact_email` was removed in 010 — it now lives in
// prospect_contact_emails as a child table managed by ContactEmailsEditor;
// the per-field lock no longer applies (the pipeline-skip-if-any-email gate
// in supabase_sync.py provides equivalent protection).
const LOCK_UI_FIELDS = new Set([
  'tier',
  'company_name',
  'company_phone',
  'company_email',
  'contact_name',
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
  initialTags: ProspectTagView[];
  initialContactEmails: ProspectContactEmail[];
  vocab: VocabRow[];
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
  initialTags,
  initialContactEmails,
  vocab,
}: ProspectDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('fields');
  const [, startTransition] = useTransition();
  const [tags, setTags] = useState<ProspectTagView[]>(initialTags);

  // Live-update tags whenever the row table changes for this prospect.
  // Uses Supabase Realtime so two reps editing the same prospect see
  // each other's chip changes within ~2s (T14).
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`prospect_tags:${prospect.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prospect_tags',
          filter: `prospect_id=eq.${prospect.id}`,
        },
        async () => {
          const res = await fetch(`/api/prospects/${prospect.id}/tags`);
          if (res.ok) {
            const fresh = (await res.json()) as ProspectTagView[];
            setTags(fresh);
          } else {
            // Fallback: hard refresh if we can't fetch incrementally.
            startTransition(() => router.refresh());
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospect.id]);

  const overrides = prospect.user_overrides as Record<string, unknown> | null | undefined;
  const editable = useMemo(() => {
    return isAdmin || prospect.assigned_to === currentUserId;
  }, [isAdmin, prospect.assigned_to, currentUserId]);

  const refresh = () => startTransition(() => router.refresh());

  async function refetchTags() {
    const res = await fetch(`/api/prospects/${prospect.id}/tags`);
    if (res.ok) setTags((await res.json()) as ProspectTagView[]);
  }

  async function handleUndoDelete(snapshot: {
    tagRowId: string;
    tagId: string;
    prospectId: string;
    lockedBy: string | null;
  }) {
    const res = await fetch(`/api/prospects/${snapshot.prospectId}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag_id: snapshot.tagId, locked_by: snapshot.lockedBy }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `HTTP ${res.status}`);
      return;
    }
    toast.success('Tag restored.');
    void refetchTags();
  }

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
        <Badge
          data-testid="stage-badge"
          variant="outline"
          className="gap-2 rounded-full border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--primary))]"
        >
          Stage 7 · Editable
        </Badge>
      </div>

      <Card className="shadow-[var(--shadow-sm)]">
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
                {prospect.company_name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <TierBadge tier={prospect.tier} />
                <StateBadge state={prospect.state} />
              </div>
            </div>
            <div className="shrink-0">
              <PresenceChips prospectId={prospect.id} currentUser={currentUser} />
            </div>
          </div>
          <Separator />
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
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-sm)]" data-testid="tags-panel">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold tracking-tight">
              Tags
            </CardTitle>
            <TagAddDialog
              prospectId={prospect.id}
              vocab={vocab}
              existingTagIds={tags.map((t) => t.tag_id)}
              onAdded={() => void refetchTags()}
            />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <TagChips
            prospectId={prospect.id}
            tags={tags}
            mode="full"
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            interactive
            onChanged={() => void refetchTags()}
            onUndoDelete={handleUndoDelete}
          />
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        data-testid="detail-tabs"
      >
        <TabsList aria-label="Detail tabs">
          <TabsTrigger value="fields" data-testid="tab-fields">
            Fields
          </TabsTrigger>
          <TabsTrigger value="notes" data-testid="tab-notes">
            Notes
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="mt-4">
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
            <ContactEmailsEditor
              prospectId={prospect.id}
              initialEmails={initialContactEmails}
              canEdit={editable}
              onChanged={refresh}
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
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesPanel
            prospectId={prospect.id}
            initialNotes={notes}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            authorLabels={profileLabels}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab
            entries={activity}
            profiles={profileLabels}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            prospectId={prospect.id}
            onChanged={() => void refetchTags()}
          />
        </TabsContent>
      </Tabs>
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
    <Card className={cn('shadow-[var(--shadow-sm)]', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold tracking-tight">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <dl className="divide-y divide-[hsl(var(--border-subtle))]">{children}</dl>
      </CardContent>
    </Card>
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
      <span className="text-muted-foreground">State:</span>
      <select
        className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
        <span className="text-xs text-destructive" data-testid="state-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
