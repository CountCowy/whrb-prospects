'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const EMPTY_FORM = {
  company_name: '',
  tier: 'C' as 'A' | 'B' | 'C',
  company_phone: '',
  website: '',
  category: '',
  zip: '',
};

export function AddProspectModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit() {
    setError(null);
    const payload: Record<string, unknown> = {
      company_name: form.company_name.trim(),
      tier: form.tier,
    };
    if (form.company_phone.trim()) payload.company_phone = form.company_phone.trim();
    if (form.website.trim()) payload.website = form.website.trim();
    if (form.category.trim()) payload.category = form.category.trim();
    if (form.zip.trim()) payload.zip = form.zip.trim();

    const res = await fetch('/api/prospects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Create failed (status ${res.status}).`);
      return;
    }
    const created = await res.json();
    setOpen(false);
    setForm(EMPTY_FORM);
    startTransition(() => router.push(`/prospects/${created.id}`));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="add-prospect-button"
        className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))]"
      >
        + Add prospect
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="add-prospect-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-xl">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Add prospect</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-xs text-[hsl(var(--muted-foreground))]"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <Field
                label="Company name"
                required
                value={form.company_name}
                onChange={(v) => setForm({ ...form, company_name: v })}
                testid="add-company-name"
              />
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  Tier
                </label>
                <select
                  value={form.tier}
                  onChange={(e) =>
                    setForm({ ...form, tier: e.target.value as 'A' | 'B' | 'C' })
                  }
                  data-testid="add-tier"
                  className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </div>
              <Field
                label="Phone (optional)"
                value={form.company_phone}
                onChange={(v) => setForm({ ...form, company_phone: v })}
                testid="add-phone"
              />
              <Field
                label="Website (optional)"
                value={form.website}
                onChange={(v) => setForm({ ...form, website: v })}
                testid="add-website"
              />
              <Field
                label="Category (optional)"
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
                testid="add-category"
              />
              <Field
                label="ZIP (optional)"
                value={form.zip}
                onChange={(v) => setForm({ ...form, zip: v })}
                testid="add-zip"
              />
            </div>
            {error ? (
              <p data-testid="add-prospect-error" className="text-xs text-red-600 dark:text-red-300">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !form.company_name.trim()}
                data-testid="add-prospect-submit"
                className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-3 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              >
                {pending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  testid?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1"
      />
    </label>
  );
}
