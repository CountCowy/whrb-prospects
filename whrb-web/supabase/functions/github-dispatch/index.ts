// Supabase Edge Function — proxies a Database Webhook envelope on a
// `pipeline_runs` INSERT with status='queued' into a GitHub
// repository_dispatch call. See plan §20.4 (Path A) + §21 for the
// reasoning: the Dashboard's webhook UI on WHRB dev does not expose
// a templatable body or a `status='queued'` filter, so we do both in
// code here.
//
// Envelope shape from Supabase:
//   { type: 'INSERT' | 'UPDATE' | 'DELETE', table: string, schema: string,
//     record: Record<string, unknown>, old_record: Record<string, unknown> | null }
//
// GitHub expects:
//   POST https://api.github.com/repos/{owner}/{repo}/dispatches
//   { event_type: string, client_payload: object }
//
// Secrets (set via `supabase secrets set ...`):
//   GH_DISPATCH_PAT — fine-grained PAT with `Contents: Read and write`
//                     on `CountCowy/whrb-prospects`.
// Compile-time constants (no-secret config):
//   GITHUB_OWNER, GITHUB_REPO, EVENT_TYPE.

const GITHUB_OWNER = 'CountCowy';
const GITHUB_REPO = 'whrb-prospects';
const EVENT_TYPE = 'pipeline_run';

interface WebhookEnvelope {
  type?: string;
  table?: string;
  schema?: string;
  record?: { id?: string; status?: string; [k: string]: unknown };
  old_record?: Record<string, unknown> | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  let env: WebhookEnvelope;
  try {
    env = (await req.json()) as WebhookEnvelope;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  // Filter — only forward pipeline_runs INSERTs with status='queued'.
  // Silently succeed for anything else so Supabase doesn't retry.
  const isQueuedInsert =
    env.type === 'INSERT' &&
    env.table === 'pipeline_runs' &&
    env.schema === 'public' &&
    env.record?.status === 'queued';
  if (!isQueuedInsert) {
    return new Response(null, { status: 204 });
  }

  const pipelineRunId = env.record?.id;
  if (typeof pipelineRunId !== 'string' || pipelineRunId.length === 0) {
    return new Response('record.id missing', { status: 400 });
  }

  const pat = Deno.env.get('GH_DISPATCH_PAT');
  if (!pat) {
    console.error('GH_DISPATCH_PAT not configured');
    return new Response('secret missing', { status: 500 });
  }

  const ghUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;
  const body = JSON.stringify({
    event_type: EVENT_TYPE,
    client_payload: { pipeline_run_id: pipelineRunId },
  });

  const ghRes = await fetch(ghUrl, {
    method: 'POST',
    headers: {
      Authorization: `token ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'whrb-prospects-dispatch/1.0',
    },
    body,
  });

  const ghText = await ghRes.text();
  // Pass GitHub's status back upstream so Supabase logs show the result.
  return new Response(
    JSON.stringify({
      forwarded: true,
      pipeline_run_id: pipelineRunId,
      github_status: ghRes.status,
      github_body: ghText.slice(0, 500),
    }),
    {
      status: ghRes.ok ? 202 : 502,
      headers: { 'Content-Type': 'application/json' },
    },
  );
});
