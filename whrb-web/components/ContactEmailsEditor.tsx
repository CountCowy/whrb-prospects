'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import type {
  ProspectContactEmail,
  ProspectContactEmailSource,
} from '@/lib/queries/prospects';

const SOURCE_LABEL: Record<ProspectContactEmailSource, string> = {
  pipeline_hunter: 'Hunter',
  pipeline_apollo: 'Apollo',
  pipeline_scraper: 'Scraped',
  manual_rep: 'Added by rep',
  legacy_scalar: 'Legacy',
};

type Snapshot = {
  emails: ProspectContactEmail[];
  primary: string | null;
  count: number;
};

type Props = {
  prospectId: string;
  initialEmails: ProspectContactEmail[];
  canEdit: boolean;
  onChanged?: () => void;
};

function sortEmails(rows: ProspectContactEmail[]): ProspectContactEmail[] {
  return [...rows].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.added_at.localeCompare(b.added_at);
  });
}

export function ContactEmailsEditor({
  prospectId,
  initialEmails,
  canEdit,
  onChanged,
}: Props) {
  const [emails, setEmails] = useState<ProspectContactEmail[]>(() =>
    sortEmails(initialEmails),
  );
  useEffect(() => {
    setEmails(sortEmails(initialEmails));
  }, [initialEmails]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();

  function applySnapshot(s: Snapshot) {
    setEmails(sortEmails(s.emails));
  }

  async function postJson(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<Snapshot> {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as
      | Snapshot
      | { error?: string };
    if (!res.ok) {
      const message = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new Error(message);
    }
    return json as Snapshot;
  }

  async function handleAdd() {
    setAddError(null);
    const value = addDraft.trim();
    if (!value) {
      setAddError('Email cannot be empty.');
      return;
    }
    try {
      const snapshot = await postJson(
        `/api/prospects/${prospectId}/contact-emails`,
        'POST',
        { email: value },
      );
      applySnapshot(snapshot);
      setAdding(false);
      setAddDraft('');
      toast.success('Email added.');
      startTransition(() => onChanged?.());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Add failed.';
      setAddError(message);
      toast.error(message);
    }
  }

  async function handleSaveEdit(emailId: string) {
    setEditError(null);
    const value = editDraft.trim();
    if (!value) {
      setEditError('Email cannot be empty.');
      return;
    }
    try {
      const snapshot = await postJson(
        `/api/prospects/${prospectId}/contact-emails/${emailId}`,
        'PATCH',
        { email: value },
      );
      applySnapshot(snapshot);
      setEditingId(null);
      setEditDraft('');
      toast.success('Email updated.');
      startTransition(() => onChanged?.());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed.';
      setEditError(message);
      toast.error(message);
    }
  }

  async function handleDelete(emailId: string, email: string) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete ${email}?`)
    ) {
      return;
    }
    const previous = emails;
    setEmails((prev) => prev.filter((e) => e.id !== emailId));
    try {
      const snapshot = await postJson(
        `/api/prospects/${prospectId}/contact-emails/${emailId}`,
        'DELETE',
      );
      applySnapshot(snapshot);
      toast.success('Email removed.');
      startTransition(() => onChanged?.());
    } catch (err) {
      setEmails(previous);
      const message = err instanceof Error ? err.message : 'Delete failed.';
      toast.error(message);
    }
  }

  async function handleSetPrimary(emailId: string) {
    const previous = emails;
    setEmails((prev) =>
      sortEmails(
        prev.map((e) => ({ ...e, is_primary: e.id === emailId })),
      ),
    );
    try {
      const snapshot = await postJson(
        `/api/prospects/${prospectId}/contact-emails/${emailId}/primary`,
        'POST',
      );
      applySnapshot(snapshot);
      toast.success('Primary changed.');
      startTransition(() => onChanged?.());
    } catch (err) {
      setEmails(previous);
      const message = err instanceof Error ? err.message : 'Primary change failed.';
      toast.error(message);
    }
  }

  return (
    <div
      data-testid="contact-emails-editor"
      className="grid grid-cols-3 items-start gap-3 py-2"
    >
      <dt className="col-span-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Contact emails
      </dt>
      <dd className="col-span-2 space-y-2 text-sm text-[hsl(var(--foreground))]">
        {emails.length === 0 ? (
          <div className="text-[hsl(var(--muted-foreground))]">—</div>
        ) : (
          <ul className="space-y-1.5" data-testid="contact-emails-list">
            {emails.map((row) => {
              const isEditing = editingId === row.id;
              return (
                <li
                  key={row.id}
                  data-testid={`contact-email-row-${row.id}`}
                  data-primary={row.is_primary ? 'true' : 'false'}
                  className="flex flex-wrap items-center gap-2"
                >
                  {isEditing ? (
                    <>
                      <input
                        type="email"
                        className="min-w-[240px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        data-testid={`contact-email-input-${row.id}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(row.id)}
                        disabled={pending}
                        data-testid={`contact-email-save-${row.id}`}
                        className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-2 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft('');
                          setEditError(null);
                        }}
                        className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="font-medium"
                        data-testid={`contact-email-value-${row.id}`}
                      >
                        {row.email}
                      </span>
                      {row.is_primary ? (
                        <span
                          aria-label="primary"
                          title="Primary email — shown in lists and exports."
                          className="inline-flex items-center gap-1 rounded border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--primary))]"
                          data-testid={`contact-email-primary-flag-${row.id}`}
                        >
                          ★ Primary
                        </span>
                      ) : null}
                      <span
                        title={`Source: ${SOURCE_LABEL[row.source]}`}
                        className="inline-flex items-center rounded border border-[hsl(var(--border))] bg-transparent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]"
                      >
                        {SOURCE_LABEL[row.source]}
                      </span>
                      {canEdit ? (
                        <div className="flex items-center gap-2">
                          {!row.is_primary ? (
                            <button
                              type="button"
                              onClick={() => handleSetPrimary(row.id)}
                              disabled={pending}
                              data-testid={`contact-email-set-primary-${row.id}`}
                              className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
                            >
                              Make primary
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(row.id);
                              setEditDraft(row.email);
                              setEditError(null);
                            }}
                            data-testid={`contact-email-edit-${row.id}`}
                            className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id, row.email)}
                            disabled={pending}
                            data-testid={`contact-email-delete-${row.id}`}
                            className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-red-600 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {editError ? (
          <p
            data-testid="contact-emails-edit-error"
            className="text-xs text-red-600 dark:text-red-300"
          >
            {editError}
          </p>
        ) : null}
        {canEdit ? (
          adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                className="min-w-[240px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                placeholder="name@example.com"
                value={addDraft}
                onChange={(e) => setAddDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAdd();
                  }
                }}
                data-testid="contact-email-add-input"
                autoFocus
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={pending}
                data-testid="contact-email-add-save"
                className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-2 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setAddDraft('');
                  setAddError(null);
                }}
                className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
              >
                Cancel
              </button>
              {addError ? (
                <p
                  data-testid="contact-email-add-error"
                  className="basis-full text-xs text-red-600 dark:text-red-300"
                >
                  {addError}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setAddError(null);
              }}
              data-testid="contact-email-add-button"
              className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
            >
              + Add email
            </button>
          )
        ) : null}
      </dd>
    </div>
  );
}
