'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

const TITLE_MAX = 60;
const BODY_MAX_WORDS = 500;

export function ChangelogAdminEditor() {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'rep' | 'admin'>('all');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const titleOver = title.length > TITLE_MAX;
  const wordsOver = wordCount > BODY_MAX_WORDS;
  const slugInvalid =
    !!slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

  const canSubmit =
    !!slug.trim() &&
    !!title.trim() &&
    !!body.trim() &&
    !titleOver &&
    !wordsOver &&
    !slugInvalid &&
    !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/changelog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slug.trim(),
          title: title.trim(),
          body_mdx: body.trim(),
          audience,
          pinned,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || 'Failed to publish changelog entry');
        return;
      }
      toast.success('Changelog entry published');
      setSlug('');
      setTitle('');
      setBody('');
      setAudience('all');
      setPinned(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      data-testid="changelog-admin-editor"
      className="space-y-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="changelog-slug">Slug</Label>
          <Input
            id="changelog-slug"
            data-testid="changelog-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="t4-launch"
            aria-invalid={slugInvalid}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Lowercase letters, digits, hyphens. Must be unique.
          </p>
        </div>
        <div>
          <Label htmlFor="changelog-audience">Audience</Label>
          <select
            id="changelog-audience"
            data-testid="changelog-audience"
            value={audience}
            onChange={(e) =>
              setAudience(e.target.value as 'all' | 'rep' | 'admin')
            }
            className="mt-1 h-9 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-sm"
          >
            <option value="all">All (everyone)</option>
            <option value="rep">Reps only</option>
            <option value="admin">Admins only</option>
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="changelog-title">Title</Label>
        <Input
          id="changelog-title"
          data-testid="changelog-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX + 30}
          aria-invalid={titleOver}
          className="mt-1"
        />
        <p
          className={`mt-1 text-xs ${
            titleOver
              ? 'text-[hsl(var(--destructive))]'
              : 'text-[hsl(var(--muted-foreground))]'
          }`}
          data-testid="changelog-title-counter"
        >
          {title.length} / {TITLE_MAX}
        </p>
      </div>

      <div>
        <Label htmlFor="changelog-body">Body (plain text — wraps as markdown)</Label>
        <Textarea
          id="changelog-body"
          data-testid="changelog-body-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          aria-invalid={wordsOver}
          className="mt-1"
        />
        <p
          className={`mt-1 text-xs ${
            wordsOver
              ? 'text-[hsl(var(--destructive))]'
              : 'text-[hsl(var(--muted-foreground))]'
          }`}
          data-testid="changelog-body-counter"
        >
          {wordCount} / {BODY_MAX_WORDS} words
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="changelog-pinned"
          data-testid="changelog-pinned"
          checked={pinned}
          onCheckedChange={(v) => setPinned(Boolean(v))}
        />
        <Label htmlFor="changelog-pinned" className="cursor-pointer">
          Pin entry (floats to top for 14 days)
        </Label>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={!canSubmit}
          data-testid="changelog-publish"
        >
          {submitting ? 'Publishing…' : 'Publish entry'}
        </Button>
        {(titleOver || wordsOver || slugInvalid) ? (
          <span className="text-xs text-[hsl(var(--destructive))]">
            Fix the highlighted field(s) before publishing.
          </span>
        ) : null}
      </div>
    </form>
  );
}
