import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProspect } from '@/lib/queries/prospects';
import { listNotesForProspect } from '@/lib/queries/notes';
import { TierBadge } from '@/components/TierBadge';
import { StateBadge } from '@/components/StateBadge';
import { formatDateTime, formatRelative } from '@/lib/time';

export const dynamic = 'force-dynamic';

type FieldRow = { label: string; value: string | number | null | undefined; testid?: string };

function StackedFields({ rows }: { rows: FieldRow[] }) {
  return (
    <dl className="divide-y divide-[hsl(var(--border-subtle))]">
      {rows.map((r) => (
        <div
          key={r.label}
          data-testid={r.testid ?? `field-${r.label.toLowerCase().replace(/\s+/g, '-')}`}
          className="grid grid-cols-3 items-baseline gap-3 py-2"
        >
          <dt className="col-span-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {r.label}
          </dt>
          <dd className="col-span-2 break-words text-sm text-[hsl(var(--foreground))]">
            {r.value === null || r.value === undefined || r.value === '' ? (
              <span className="text-[hsl(var(--muted-foreground))]">—</span>
            ) : (
              String(r.value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) notFound();

  const notes = await listNotesForProspect(id);
  const assignee = prospect.assignee
    ? prospect.assignee.display_name ?? prospect.assignee.email
    : 'Unassigned';

  const companyFields: FieldRow[] = [
    { label: 'Company name', value: prospect.company_name },
    { label: 'Category', value: prospect.category },
    { label: 'Source', value: prospect.source },
    { label: 'Website', value: prospect.website },
    { label: 'Company phone', value: prospect.company_phone },
    { label: 'Company email', value: prospect.company_email },
    { label: 'Address', value: prospect.address },
    { label: 'ZIP', value: prospect.zip },
  ];

  const contactFields: FieldRow[] = [
    { label: 'Contact name', value: prospect.contact_name },
    { label: 'Contact title', value: prospect.contact_title },
    { label: 'Contact phone', value: prospect.contact_phone },
    { label: 'Contact email', value: prospect.contact_email },
    { label: 'LinkedIn', value: prospect.contact_linkedin },
    { label: 'Sales email', value: prospect.sales_email },
  ];

  const metaFields: FieldRow[] = [
    { label: 'Priority score', value: prospect.priority_score },
    { label: 'Rating', value: prospect.rating },
    { label: 'Reviews', value: prospect.review_count },
    { label: 'Seasonality', value: prospect.seasonality_window },
    { label: 'Is nonprofit', value: prospect.is_nonprofit ? 'Yes' : prospect.is_nonprofit === false ? 'No' : null },
    { label: 'Nonprofit source', value: prospect.nonprofit_source },
    { label: 'EIN', value: prospect.ein },
    { label: 'Business key', value: prospect.business_key },
    {
      label: 'Pipeline last seen',
      value: prospect.pipeline_last_seen_at ? formatDateTime(prospect.pipeline_last_seen_at) : null,
    },
    { label: 'Created', value: formatDateTime(prospect.created_at) },
    { label: 'Created source', value: prospect.created_source },
    { label: 'Pipeline notes', value: prospect.pipeline_notes },
  ];

  const altEntries = prospect.alt_fields
    ? Object.entries(prospect.alt_fields).filter(([, v]) => v !== null && v !== undefined)
    : [];

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
          Read-only · Stage 6
        </span>
      </div>
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)]">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {prospect.company_name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <TierBadge tier={prospect.tier} />
            <StateBadge state={prospect.state} />
            <span data-testid="detail-assignee">Assigned to: {assignee}</span>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="mb-2 text-base font-semibold tracking-tight">Company</h2>
          <StackedFields rows={companyFields} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="mb-2 text-base font-semibold tracking-tight">Primary contact</h2>
          <StackedFields rows={contactFields} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)] lg:col-span-2">
          <h2 className="mb-2 text-base font-semibold tracking-tight">Pipeline data</h2>
          <StackedFields rows={metaFields} />
        </div>
        {altEntries.length > 0 && (
          <div
            data-testid="alt-fields"
            className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)] lg:col-span-2"
          >
            <h2 className="mb-2 text-base font-semibold tracking-tight">
              Alternate values
              <span className="ml-2 text-xs font-normal text-[hsl(var(--muted-foreground))]">
                dropped by dedupe, preserved for audit
              </span>
            </h2>
            <StackedFields
              rows={altEntries.map(([key, value]) => ({
                label: key.replace(/^alt_/, '').replace(/_/g, ' '),
                value: typeof value === 'string' ? value : JSON.stringify(value),
                testid: `alt-${key}`,
              }))}
            />
          </div>
        )}
      </section>

      <section
        data-testid="notes-section"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Notes</h2>
          <span className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Editing lands in Stage 7
          </span>
        </div>
        {notes.length === 0 ? (
          <p
            data-testid="notes-empty"
            className="text-sm text-[hsl(var(--muted-foreground))]"
          >
            No notes yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li
                key={n.id}
                data-testid="note-item"
                className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] p-3"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                  <span className="font-medium text-[hsl(var(--foreground))]">
                    {n.author?.display_name || n.author?.email?.split('@')[0] || 'Unknown'}
                  </span>
                  <span className="tabular-nums" title={formatDateTime(n.created_at)}>
                    {formatRelative(n.created_at)}
                    {n.edited_at ? ' · edited' : ''}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
