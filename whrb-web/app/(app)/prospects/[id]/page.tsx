import { notFound } from 'next/navigation';
import { getProspect } from '@/lib/queries/prospects';
import { listNotesForProspect } from '@/lib/queries/notes';
import { listActivityForProspect } from '@/lib/queries/activity';
import { listProfilesWithCounts, getProfile } from '@/lib/queries/profiles';
import { createClient } from '@/lib/supabase/server';
import { ProspectDetail } from '@/components/ProspectDetail';

export const dynamic = 'force-dynamic';

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const me = await getProfile(user.id);
  const isAdmin = me?.role === 'admin';

  const [notes, activity, profiles] = await Promise.all([
    listNotesForProspect(id, { includeDeleted: Boolean(isAdmin) }),
    listActivityForProspect(id, { includeDeletedNoteHistory: Boolean(isAdmin) }),
    listProfilesWithCounts(),
  ]);

  const profileLabels: Record<string, string> = Object.fromEntries(
    profiles.map((p) => [p.id, p.display_name || p.email.split('@')[0]]),
  );

  return (
    <ProspectDetail
      prospect={prospect}
      notes={notes}
      activity={activity}
      profiles={profiles.map((p) => ({
        id: p.id,
        email: p.email,
        display_name: p.display_name,
      }))}
      profileLabels={profileLabels}
      currentUserId={user.id}
      isAdmin={Boolean(isAdmin)}
    />
  );
}
