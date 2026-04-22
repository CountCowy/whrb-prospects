'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { AdminProfile } from '@/lib/queries/admin';
import { formatDate } from '@/lib/time';

export function UsersManager({
  rows,
  currentUserId,
}: {
  rows: AdminProfile[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  async function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteBusy(true);
    try {
      const res = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          display_name: inviteName.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'unknown' }));
        toast.error(`Invite failed: ${body.error ?? res.statusText}`);
        return;
      }
      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteName('');
      startTransition(() => router.refresh());
    } finally {
      setInviteBusy(false);
    }
  }

  async function changeRole(id: string, role: 'admin' | 'rep') {
    const res = await fetch(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }));
      toast.error(`Role change failed: ${body.error ?? res.statusText}`);
      return;
    }
    toast.success(`Role set to ${role}`);
    startTransition(() => router.refresh());
  }

  async function setDeactivated(id: string, deactivated: boolean) {
    const res = await fetch(`/api/admin/users/${id}/deactivate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deactivated }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }));
      toast.error(`Deactivation failed: ${body.error ?? res.statusText}`);
      return;
    }
    toast.success(deactivated ? 'User deactivated' : 'User reactivated');
    startTransition(() => router.refresh());
  }

  async function removeUser(id: string, email: string) {
    const confirmed = window.confirm(
      `Permanently remove ${email}? This deletes the account and all associated auth records.`,
    );
    if (!confirmed) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }));
      toast.error(`Remove failed: ${body.error ?? res.statusText}`);
      return;
    }
    toast.success(`Removed ${email}`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onInvite}
        data-testid="invite-form"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
          Invite a team member
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
          <label className="block text-sm font-medium">
            Email
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="you@example.com"
              data-testid="invite-email"
              className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium">
            Display name (optional)
            <input
              type="text"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              data-testid="invite-name"
              className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={inviteBusy || pending}
            data-testid="invite-submit"
            className="self-end rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-60"
          >
            {inviteBusy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          An email with a magic-link sign-in is sent via Supabase&rsquo;s default
          SMTP. Resend branded email lands in Stage 11 cutover.
        </p>
      </form>

      <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
        <table data-testid="users-table" className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Display name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isSelf = p.id === currentUserId;
              const isDeactivated = Boolean(p.deactivated_at);
              return (
                <tr
                  key={p.id}
                  data-testid="user-row"
                  data-user-id={p.id}
                  data-role={p.role}
                  data-deactivated={isDeactivated ? 'true' : 'false'}
                  className="border-t border-[hsl(var(--border-subtle))]"
                >
                  <td className="px-4 py-3 font-medium">{p.email}</td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {p.display_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role for ${p.email}`}
                      data-testid={`role-select-${p.id}`}
                      value={p.role}
                      onChange={(e) =>
                        changeRole(p.id, e.target.value as 'admin' | 'rep')
                      }
                      disabled={pending}
                      className="rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                    >
                      <option value="rep">rep</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {isDeactivated ? (
                      <span className="rounded-full bg-[hsl(var(--destructive))]/10 px-2 py-[2px] text-[10px] font-medium text-[hsl(var(--destructive))]">
                        deactivated
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-[2px] text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={pending || isSelf}
                        data-testid={`deactivate-${p.id}`}
                        onClick={() => setDeactivated(p.id, !isDeactivated)}
                        className="rounded-md border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                      >
                        {isDeactivated ? 'Reactivate' : 'Deactivate'}
                      </button>
                      <button
                        type="button"
                        disabled={pending || isSelf}
                        data-testid={`remove-${p.id}`}
                        onClick={() => removeUser(p.id, p.email)}
                        className="rounded-md border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/5 px-2.5 py-1 text-xs font-medium text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
