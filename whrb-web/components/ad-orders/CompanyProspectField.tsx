'use client';

import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ProspectSuggestion = {
  id: string;
  company_name: string;
  tier: string | null;
  state: string | null;
};

type Props = {
  companyName: string;
  prospectId: string;
  /** Snapshot of the linked prospect (only used to render the badge label
   *  in edit mode when no live search has happened yet). */
  linkedProspectName: string | null;
  disabled?: boolean;
  onChange: (next: { companyName: string; prospectId: string }) => void;
};

/**
 * Combined Company / linked-prospect picker.
 *
 * - The visible field is always the typed `company_name` (free-text editable).
 * - As the user types ≥ 2 chars, a debounced GET /api/prospects/search
 *   populates a dropdown of suggestions.
 * - Picking a suggestion fills `company_name` AND sets `prospect_id` to
 *   that prospect's UUID under the hood. The link survives subsequent
 *   edits to company_name (denormalized by design — see migration 018).
 * - When `prospect_id` is set, a small "Linked: <name> [Unlink]" badge
 *   appears beneath the input. Unlink clears `prospect_id` only and
 *   leaves the typed text alone (treats the order as a one-off).
 */
export function CompanyProspectField({
  companyName,
  prospectId,
  linkedProspectName,
  disabled,
  onChange,
}: Props) {
  const [suggestions, setSuggestions] = useState<ProspectSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Track the canonical name of the linked prospect so the badge stays
  // accurate when the user edits company_name after picking.
  const [linkedName, setLinkedName] = useState<string | null>(linkedProspectName);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Click-outside to close the dropdown.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function search(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/prospects/search?q=${encodeURIComponent(q)}&limit=20`,
          { cache: 'no-store' },
        );
        if (!r.ok) {
          setSuggestions([]);
          return;
        }
        const body = await r.json();
        setSuggestions((body.prospects ?? []) as ProspectSuggestion[]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }

  function handleType(value: string) {
    onChange({ companyName: value, prospectId });
    if (value.trim().length >= 2) {
      setOpen(true);
      search(value.trim());
    } else {
      setOpen(false);
      setSuggestions([]);
    }
  }

  function pick(p: ProspectSuggestion) {
    setLinkedName(p.company_name);
    setOpen(false);
    onChange({ companyName: p.company_name, prospectId: p.id });
  }

  function unlink() {
    setLinkedName(null);
    onChange({ companyName, prospectId: '' });
  }

  return (
    <div ref={wrapRef} className="relative">
      <Label htmlFor="company_name">Company *</Label>
      <Input
        id="company_name"
        value={companyName}
        disabled={disabled}
        onFocus={() => {
          if (companyName.trim().length >= 2) {
            setOpen(true);
            search(companyName.trim());
          }
        }}
        onChange={(e) => handleType(e.target.value)}
        autoComplete="off"
        required
      />
      {prospectId && linkedName && (
        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Linked to prospect: <strong className="font-medium">{linkedName}</strong>
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={unlink}
              className="text-xs underline hover:text-foreground"
            >
              Unlink (treat as one-off)
            </button>
          )}
        </p>
      )}
      {!prospectId && companyName.trim().length >= 2 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Not linked to a prospect — will be saved as a one-off advertiser.
        </p>
      )}
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
          )}
          {!loading && suggestions.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No matching prospects. Keep typing to use as one-off.
            </div>
          )}
          {!loading && suggestions.length > 0 && (
            <ul className="max-h-72 overflow-y-auto py-1">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate">{p.company_name}</span>
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                      {p.tier ? `Tier ${p.tier}` : ''}
                      {p.tier && p.state ? ' · ' : ''}
                      {p.state ?? ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
