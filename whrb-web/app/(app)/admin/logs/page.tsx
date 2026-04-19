import { PagePlaceholder } from '@/components/PagePlaceholder';

export default function AdminLogsPage() {
  return (
    <PagePlaceholder
      eyebrow="Admin"
      title="Event log"
      description="Searchable view over the unified event_log stream — pipeline, web server, and client exceptions in one place. Ships in Stage 9."
      stage="Stage 9"
    />
  );
}
