'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

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
      <Button
        type="button"
        size="sm"
        variant="primary"
        leadingIcon={Plus}
        onClick={() => setOpen(true)}
        data-testid="add-prospect-button"
      >
        Add prospect
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="add-prospect-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Add prospect</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3">
              <Input
                label="Company name *"
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                data-testid="add-company-name"
              />
              <Select
                label="Tier"
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value as 'A' | 'B' | 'C' })}
                data-testid="add-tier"
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </Select>
              <Input
                label="Phone (optional)"
                value={form.company_phone}
                onChange={(e) => setForm({ ...form, company_phone: e.target.value })}
                data-testid="add-phone"
              />
              <Input
                label="Website (optional)"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                data-testid="add-website"
              />
              <Input
                label="Category (optional)"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                data-testid="add-category"
              />
              <Input
                label="ZIP (optional)"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                data-testid="add-zip"
              />
            </div>
            {error ? (
              <p
                data-testid="add-prospect-error"
                className="text-xs text-[hsl(var(--destructive))]"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={submit}
                disabled={pending || !form.company_name.trim()}
                data-testid="add-prospect-submit"
              >
                {pending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
