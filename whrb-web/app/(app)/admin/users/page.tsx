import { listAdminProfiles } from '@/lib/queries/admin';
import { getAuthed } from '@/lib/server/authz';
import { UsersManager } from '@/components/admin/UsersManager';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const [rows, authz] = await Promise.all([listAdminProfiles(), getAuthed()]);
  if (authz.kind === 'unauth') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Users &amp; access
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          Invite new team members, promote admins, deactivate accounts
          (reversible), or permanently remove them. Deactivated users are signed
          out on their next request.
        </p>
      </div>
      <UsersManager rows={rows} currentUserId={authz.user.id} />
    </div>
  );
}
