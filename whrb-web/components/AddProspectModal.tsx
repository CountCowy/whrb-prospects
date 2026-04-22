'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="add-prospect-button">
          <Plus className="h-4 w-4" />
          Add prospect
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid="add-prospect-modal">
        <DialogHeader>
          <DialogTitle>Add prospect</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field
            label="Company name"
            required
            value={form.company_name}
            onChange={(v) => setForm({ ...form, company_name: v })}
            testid="add-company-name"
          />
          <div className="flex items-center gap-2">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Tier
            </Label>
            <select
              value={form.tier}
              onChange={(e) =>
                setForm({ ...form, tier: e.target.value as 'A' | 'B' | 'C' })
              }
              data-testid="add-tier"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
          <p
            data-testid="add-prospect-error"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={pending || !form.company_name.trim()}
            data-testid="add-prospect-submit"
          >
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
    </label>
  );
}
