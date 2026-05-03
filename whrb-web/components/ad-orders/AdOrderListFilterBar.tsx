'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  AdOrderListFilters,
  AdOrderListSort,
} from '@/lib/ad-orders/shared';

type Props = {
  filters: AdOrderListFilters;
  sort: AdOrderListSort;
};

export function AdOrderListFilterBar({ filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(filters.q ?? '');

  function setParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(sp.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    next.delete('page');
    router.push(`?${next.toString()}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam('q', q.trim() || undefined);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
      <form onSubmit={submitSearch} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q" className="text-xs">
            Search
          </Label>
          <Input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Promo ID, company, contact, invoice…"
            className="w-72"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Search
        </Button>
      </form>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Paid</Label>
        <select
          value={filters.paid ?? ''}
          onChange={(e) => setParam('paid', e.target.value || undefined)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="true">Paid</option>
          <option value="false">Unpaid</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Commission</Label>
        <select
          value={filters.commission_paid ?? ''}
          onChange={(e) => setParam('commission_paid', e.target.value || undefined)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="true">Paid out</option>
          <option value="false">Owed</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Semester</Label>
        <Input
          value={filters.semester ?? ''}
          onChange={(e) => setParam('semester', e.target.value || undefined)}
          placeholder="e.g. FA2025"
          className="w-28"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">View</Label>
        <select
          value={filters.archived ?? ''}
          onChange={(e) => setParam('archived', e.target.value || undefined)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="">Active</option>
          <option value="true">Archived</option>
        </select>
      </div>

      {(filters.q ||
        filters.paid ||
        filters.commission_paid ||
        filters.semester ||
        filters.archived) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('?')}
          className="ml-auto"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
