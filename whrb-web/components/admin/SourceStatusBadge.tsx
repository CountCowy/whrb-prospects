import { Badge } from '@/components/ui/badge';
import type { SourceStatus } from '@/lib/queries/sources';

/**
 * Shared status badge for /admin/sources (list + detail pages). Maps
 * the four lifecycle states to the warm-palette badge variants:
 *
 *   active            → success  (positive semantic state, not a CTA)
 *   sunset_proposed   → warning  (transitional, still running)
 *   sunset            → secondary (parked but not destroyed)
 *   archived          → destructive (terminal)
 */
export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const variant: 'success' | 'warning' | 'secondary' | 'destructive' =
    status === 'active'
      ? 'success'
      : status === 'sunset_proposed'
        ? 'warning'
        : status === 'sunset'
          ? 'secondary'
          : 'destructive';
  const label =
    status === 'active'
      ? 'Active'
      : status === 'sunset_proposed'
        ? 'Sunset proposed'
        : status === 'sunset'
          ? 'Sunset'
          : 'Archived';
  return (
    <Badge
      variant={variant}
      data-testid="source-status-badge"
      data-status={status}
    >
      {label}
    </Badge>
  );
}
