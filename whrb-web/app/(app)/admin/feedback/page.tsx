import { listAdminFeedback } from '@/lib/queries/admin';
import { FeedbackTriageList } from '@/components/admin/FeedbackTriageList';

export const dynamic = 'force-dynamic';

export default async function AdminFeedbackPage() {
  const rows = await listAdminFeedback();

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Feedback triage
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          Update the status of each submission and leave a response. Changes
          surface on the author&rsquo;s Home page the next time they reload.
        </p>
      </div>
      <FeedbackTriageList rows={rows} />
    </div>
  );
}
