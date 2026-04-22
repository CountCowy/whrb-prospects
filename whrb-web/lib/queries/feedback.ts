import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type FeedbackRow = {
  id: string;
  author_id: string | null;
  category: 'bug' | 'idea' | 'data_issue' | 'other';
  body: string;
  page_url: string | null;
  user_agent: string | null;
  status: 'new' | 'acknowledged' | 'in_progress' | 'closed';
  admin_response: string | null;
  created_at: string;
};

export async function listMyFeedback(): Promise<FeedbackRow[]> {
  const supabase = await createClient();
  // Stage 10c: product-intent author filter. RLS allows admins to read all
  // feedback rows (p_feedback_read_self_or_admin), so without this clause
  // the Home widget shows team-wide feedback under "Your feedback" for
  // admins. The dedicated team-wide triage view is /admin/feedback.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('author_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as FeedbackRow[];
}
