'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { AXES, type Axis } from '@/styles/tag-colors';
import type { VocabRow } from '@/lib/queries/vocab';

export type TagAddDialogProps = {
  prospectId: string;
  vocab: VocabRow[];
  /** Tag-row IDs already on this prospect — the picker hides them. */
  existingTagIds: string[];
  onAdded?: () => void;
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Two modes — pick existing vocab (autocomplete) OR submit a new value
 * (axis picker + value input). The new-value path warns about admin
 * review and POSTs both `tag_vocabulary` (status=pending) and
 * `prospect_tags` rows. The DB trigger `on_pending_tag_use` dedups the
 * resulting admin notification.
 */
export function TagAddDialog({
  prospectId,
  vocab,
  existingTagIds,
  onAdded,
}: TagAddDialogProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'existing' | 'new'>('existing');
  const [busy, setBusy] = useState(false);

  // Existing-vocab picker state
  const [pickAxis, setPickAxis] = useState<Axis>('sector');
  const [pickValueId, setPickValueId] = useState<string>('');

  // New-vocab state
  const [newAxis, setNewAxis] = useState<Axis>('other');
  const [newValue, setNewValue] = useState('');

  const visibleVocab = useMemo(() => {
    return vocab
      .filter((r) => r.status === 'active' || r.status === 'pending_admin_review')
      .filter((r) => !existingTagIds.includes(r.id));
  }, [vocab, existingTagIds]);

  const axisVocab = useMemo(() => {
    return visibleVocab
      .filter((r) => r.axis === pickAxis)
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [visibleVocab, pickAxis]);

  async function handlePick() {
    if (!pickValueId || busy) return;
    setBusy(true);
    const res = await fetch(`/api/prospects/${prospectId}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag_id: pickValueId }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `HTTP ${res.status}`);
      return;
    }
    toast.success('Tag added.');
    setPickValueId('');
    setOpen(false);
    if (onAdded) onAdded();
  }

  async function handleNew() {
    const cleaned = newValue.trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleaned) {
      toast.error('Tag value is required.');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(cleaned)) {
      toast.error('Tag value must be lower_snake_case [a-z0-9_].');
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/prospects/${prospectId}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ axis: newAxis, value: cleaned, is_new_vocab: true }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `HTTP ${res.status}`);
      return;
    }
    toast.success(`Created ${newAxis}:${cleaned} (admin review pending).`);
    setNewValue('');
    setOpen(false);
    if (onAdded) onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="tag-add-button"
          className="text-xs"
        >
          + Add tag
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="tag-add-dialog">
        <DialogHeader>
          <DialogTitle>Add a tag</DialogTitle>
          <DialogDescription>
            Pick from the existing vocab or propose a new value. New
            values are reviewed by an admin before showing up site-wide.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="existing" data-testid="tag-add-tab-existing">
              Existing vocab
            </TabsTrigger>
            <TabsTrigger value="new" data-testid="tag-add-tab-new">
              New value
            </TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="space-y-3 pt-3">
            <div>
              <Label htmlFor="tag-add-pick-axis">Axis</Label>
              <select
                id="tag-add-pick-axis"
                data-testid="tag-add-pick-axis"
                value={pickAxis}
                onChange={(e) => {
                  setPickAxis(e.target.value as Axis);
                  setPickValueId('');
                }}
                className={SELECT_CLASS}
              >
                {AXES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tag-add-pick-value">Value</Label>
              <select
                id="tag-add-pick-value"
                data-testid="tag-add-pick-value"
                value={pickValueId}
                onChange={(e) => setPickValueId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Select…</option>
                {axisVocab.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.value}
                    {r.status === 'pending_admin_review' ? ' (pending)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </TabsContent>

          <TabsContent value="new" className="space-y-3 pt-3">
            <p className="rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-900 dark:text-yellow-200">
              New tag values are reviewed by an admin before appearing
              site-wide. The tag will still attach to this prospect
              immediately.
            </p>
            <div>
              <Label htmlFor="tag-add-new-axis">Axis</Label>
              <select
                id="tag-add-new-axis"
                data-testid="tag-add-new-axis"
                value={newAxis}
                onChange={(e) => setNewAxis(e.target.value as Axis)}
                className={SELECT_CLASS}
              >
                {AXES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tag-add-new-value">Value (lower_snake_case)</Label>
              <Input
                id="tag-add-new-value"
                data-testid="tag-add-new-value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. arts_council_grantee"
                pattern="[a-z0-9_]+"
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            data-testid="tag-add-cancel"
          >
            Cancel
          </Button>
          {tab === 'existing' ? (
            <Button
              type="button"
              size="sm"
              onClick={handlePick}
              disabled={!pickValueId || busy}
              data-testid="tag-add-pick-submit"
            >
              Add tag
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleNew}
              disabled={!newValue.trim() || busy}
              data-testid="tag-add-new-submit"
            >
              Submit for review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
