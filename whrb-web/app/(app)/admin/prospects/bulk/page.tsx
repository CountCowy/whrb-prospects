import { redirect } from 'next/navigation';
import { getAuthed } from '@/lib/server/authz';
import { listProfilesWithCounts } from '@/lib/queries/profiles';
import { BulkActionsForm } from '@/components/admin/BulkActionsForm';

export const dynamic = 'force-dynamic';

export default async function BulkActionsPage() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/admin/prospects/bulk');
  if (authz.user.role !== 'admin') redirect('/');

  const profiles = await listProfilesWithCounts();
  const assignees = profiles.map((p) => ({
    id: p.id,
    label: p.display_name?.trim() || p.email,
    deactivated: Boolean((p as { deactivated_at?: string | null }).deactivated_at),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          Admin
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Bulk actions</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Pick a filter, preview the matching rows, then apply a bulk assign / state / tier
          change or delete. Bulk delete is irreversible — it hard-deletes the rows along with
          their notes, notifications, and presence entries.
        </p>
      </div>
      <BulkActionsForm assignees={assignees} />
    </div>
  );
}
