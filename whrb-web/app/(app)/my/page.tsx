import Link from 'next/link';
import { SearchInput } from '@/components/SearchInput';
import { FilterBar } from '@/components/FilterBar';
import { TagFilterBar } from '@/components/TagFilterBar';
import { ProspectTable } from '@/components/ProspectTable';
import { ProspectCardList } from '@/components/ProspectCardList';
import { KanbanBoard } from '@/components/KanbanBoard';
import { KanbanMobile } from '@/components/KanbanMobile';
import { MyClientsRealtime } from '@/components/MyClientsRealtime';
import { ExportCurrentFilters } from '@/components/ExportCurrentFilters';
import { MobilePageSizeGuard } from '@/components/MobilePageSizeGuard';
import {
  listProspects,
  getFilterFacets,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
} from '@/lib/queries/prospects';
import { listVocab } from '@/lib/queries/vocab';
import { getTagsForProspects } from '@/lib/queries/prospect-tags';
import { readTagFilterFromParams } from '@/lib/tag-filters';
import { getProfile } from '@/lib/queries/profiles';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseSort(sp: SearchParams): { field: string; dir: 'asc' | 'desc' } {
  const field = firstString(sp.sort) ?? 'priority_score';
  const dir = firstString(sp.dir) === 'asc' ? 'asc' : 'desc';
  return { field, dir };
}

function parsePageSize(sp: SearchParams): number {
  const raw = Number(firstString(sp.pageSize));
  return (PAGE_SIZES as readonly number[]).includes(raw) ? raw : DEFAULT_PAGE_SIZE;
}

function currentSearchString(sp: SearchParams): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) out.append(k, item);
    else out.set(k, v);
  }
  return out.toString();
}

export default async function MyClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const view = firstString(sp.view) === 'kanban' ? 'kanban' : 'table';
  const sort = parseSort(sp);
  const pageSize = view === 'kanban' ? 500 : parsePageSize(sp);
  const page = Math.max(1, Number(firstString(sp.page)) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;
  const me = await getProfile(userId);
  const isAdmin = me?.role === 'admin';

  const filters = {
    q: firstString(sp.q),
    tier: firstString(sp.tier),
    state: firstString(sp.state),
    zip: firstString(sp.zip),
    category: firstString(sp.category),
    source: firstString(sp.source),
    is_nonprofit: firstString(sp.is_nonprofit) as 'true' | 'false' | undefined,
  };

  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') urlParams.set(k, v);
    else if (Array.isArray(v) && v.length > 0) urlParams.set(k, v[0]);
  }
  const tagFilterState = readTagFilterFromParams(urlParams);
  const daypartValues = await getDaypartValuesForMy(supabase);

  const [facets, vocab, result] = await Promise.all([
    getFilterFacets(),
    listVocab(),
    listProspects({
      filters,
      sort,
      page,
      pageSize,
      assignedToSelf: true,
      selfUserId: userId,
      tagFilter: tagFilterState.byAxis,
      daypartFilter: tagFilterState.daypart,
    }),
  ]);

  const tagsMap = await getTagsForProspects(result.rows.map((r) => r.id));
  const tagsRecord: Record<string, typeof tagsMap extends Map<string, infer V> ? V : never> = {};
  for (const [k, v] of tagsMap) tagsRecord[k] = v;

  const kanbanCards = result.rows.map((r) => ({
    id: r.id,
    company_name: r.company_name,
    tier: r.tier,
    state: r.state,
    priority_score: r.priority_score,
  }));

  const kanbanIds = kanbanCards.map((c) => c.id);
  let initialPresence: Record<string, number> = {};
  if (view === 'kanban' && kanbanIds.length > 0) {
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: presenceRows } = await supabase
      .from('prospect_presence')
      .select('prospect_id,user_id,last_seen_at')
      .in('prospect_id', kanbanIds)
      .gte('last_seen_at', since);
    const counts: Record<string, number> = {};
    for (const row of presenceRows ?? []) {
      const pid = row.prospect_id as string;
      const uid = row.user_id as string;
      if (!pid || uid === userId) continue;
      counts[pid] = (counts[pid] ?? 0) + 1;
    }
    initialPresence = counts;
  }

  return (
    <div className="space-y-6">
      <MyClientsRealtime currentUserId={userId} />
      <MobilePageSizeGuard />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Assigned to me
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">My Clients</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle current={view} />
          <ExportCurrentFilters
            endpoint="/api/prospects/export"
            extra={{ mine: '1' }}
            testId="export-my-clients"
          />
          <SearchInput placeholder="Search my prospects…" />
        </div>
      </div>
      <TagFilterBar vocab={vocab} daypartValues={daypartValues} />
      <FilterBar
        tiers={facets.tiers}
        states={facets.states}
        sources={facets.sources}
        showAssignedFacet={false}
      />
      {view === 'kanban' ? (
        kanbanCards.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="md:hidden">
              <KanbanMobile cards={kanbanCards} />
            </div>
            <div className="hidden md:block">
              <KanbanBoard
                cards={kanbanCards}
                currentUserId={userId}
                initialPresence={initialPresence}
              />
            </div>
          </>
        )
      ) : (
        <>
          <div className="md:hidden">
            <ProspectCardList
              rows={result.rows}
              total={result.total}
              page={result.page}
              pageSize={result.pageSize}
              basePath="/my"
              currentSearch={currentSearchString(sp)}
              emptyTitle="No prospects assigned to you yet."
              emptyDescription="Rows you pick up will appear here."
            />
          </div>
          <div className="hidden md:block">
            <ProspectTable
              rows={result.rows}
              total={result.total}
              page={result.page}
              pageSize={result.pageSize}
              sort={result.sort}
              emptyTitle="No prospects assigned to you yet."
              emptyDescription="Rows you pick up will appear here."
              emptyAction={{ href: '/prospects?assigned=false', label: 'Browse unassigned' }}
              tagsByProspect={tagsRecord}
              currentUserId={userId}
              isAdmin={isAdmin}
            />
          </div>
        </>
      )}
    </div>
  );
}

async function getDaypartValuesForMy(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('prospect_daypart')
    .select('daypart_fit')
    .limit(1000);
  if (error) return [];
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ daypart_fit: string[] | null }>) {
    for (const v of row.daypart_fit ?? []) set.add(v);
  }
  return Array.from(set).sort();
}

function EmptyState() {
  return (
    <div
      data-testid="kanban-empty-state"
      className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-8 text-center"
    >
      <h2 className="text-base font-semibold">No prospects assigned yet.</h2>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        Pick one up from All Prospects to see it on the board.
      </p>
    </div>
  );
}

function ViewToggle({ current }: { current: 'table' | 'kanban' }) {
  const base = 'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors';
  return (
    <div
      role="tablist"
      aria-label="View"
      className="inline-flex rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5"
    >
      <Link
        href="/my"
        role="tab"
        aria-selected={current === 'table'}
        data-testid="view-table"
        className={`${base} ${
          current === 'table'
            ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] border-transparent'
            : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
        }`}
      >
        Table
      </Link>
      <Link
        href="/my?view=kanban"
        role="tab"
        aria-selected={current === 'kanban'}
        data-testid="view-kanban"
        className={`${base} ${
          current === 'kanban'
            ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] border-transparent'
            : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
        }`}
      >
        Kanban
      </Link>
    </div>
  );
}
