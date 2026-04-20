import { SearchInput } from '@/components/SearchInput';
import { FilterBar } from '@/components/FilterBar';
import { ProspectTable } from '@/components/ProspectTable';
import { listProspects, getFilterFacets, DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/lib/queries/prospects';

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

export default async function AllProspectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp);
  const pageSize = parsePageSize(sp);
  const page = Math.max(1, Number(firstString(sp.page)) || 1);

  const filters = {
    q: firstString(sp.q),
    tier: firstString(sp.tier),
    state: firstString(sp.state),
    assigned_to: firstString(sp.assigned_to),
    zip: firstString(sp.zip),
    category: firstString(sp.category),
    source: firstString(sp.source),
    is_nonprofit: firstString(sp.is_nonprofit) as 'true' | 'false' | undefined,
    assigned: firstString(sp.assigned) as 'true' | 'false' | undefined,
  };

  const [facets, result] = await Promise.all([
    getFilterFacets(),
    listProspects({ filters, sort, page, pageSize }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Pipeline
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">All Prospects</h1>
        </div>
        <SearchInput />
      </div>
      <FilterBar
        tiers={facets.tiers}
        states={facets.states}
        sources={facets.sources}
        showAssignedFacet
      />
      <ProspectTable
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        sort={result.sort}
        emptyTitle="No prospects yet."
        emptyDescription="Once the pipeline runs, rows will appear here."
      />
    </div>
  );
}
