import { PagePlaceholder } from '@/components/PagePlaceholder';

export default function AdminRunsPage() {
  return (
    <PagePlaceholder
      eyebrow="Admin"
      title="Pipeline runs"
      description="Timeline of ingestion and enrichment runs with duration, row counts, and failure drill-downs. Ships in Stage 9."
      stage="Stage 9"
    />
  );
}
