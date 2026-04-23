import { listVocab } from '@/lib/queries/vocab';
import { VocabManager } from '@/components/admin/VocabManager';

export const dynamic = 'force-dynamic';

export default async function AdminVocabPage() {
  const rows = await listVocab();
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Tag vocabulary
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          Manage the canonical tag vocabulary used across prospects. Pending
          admin-review tags surface at the top — these were created by reps via{' '}
          <code>TagAddDialog</code> (T3, not yet shipped). Same-axis merges only;
          to reclassify a tag across axes, edit its axis first, then merge.
        </p>
      </div>
      <VocabManager initialRows={rows} />
    </div>
  );
}
