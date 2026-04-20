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
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as FeedbackRow[];
}
