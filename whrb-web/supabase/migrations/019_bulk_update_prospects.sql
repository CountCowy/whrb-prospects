-- =========================================================================
-- 019_bulk_update_prospects.sql
--
-- Server-side bulk UPDATE for the pipeline's supabase_sync phase.
--
-- Background: PR #55 attempted to bulk via PostgREST UPSERT
-- (`INSERT ... ON CONFLICT (id) DO UPDATE`), but PostgreSQL evaluates
-- NOT NULL constraints on the INSERT plan *before* the conflict
-- resolution kicks in. The pipeline sends sparse patches without
-- ``business_key`` (only the columns we want to update), so every batch
-- failed the constraint and fell back to per-row PATCH — generating
-- ~180 ``supabase_upsert_bulk_fallback`` warn events per run on top of
-- ~10K HTTP round trips.
--
-- This RPC fixes both problems with one HTTP request per batch:
--   * Pure UPDATE semantics (no INSERT branch, no NOT NULL trip).
--   * Each row's patch is applied via COALESCE — fields absent from
--     the patch retain their existing value. This matches what
--     ``db.supabase_sync._patch_existing`` produces (non-null values
--     only).
--
-- Caller: ``db.supabase_sync._bulk_update_via_rpc`` (PR following this).
-- Returns: count of rows actually updated (so the caller can verify
-- batch integrity and log mismatches as race conditions).
-- =========================================================================

create or replace function public.bulk_update_prospects(updates jsonb)
returns int
language sql
as $$
with inputs as (
    select
        (e->>'id')::uuid                           as pid,
        jsonb_populate_record(null::prospects, e->'patch') as rec
    from jsonb_array_elements(updates) as e
),
updated as (
    update prospects p set
        company_name          = coalesce((i.rec).company_name,          p.company_name),
        website               = coalesce((i.rec).website,               p.website),
        company_phone         = coalesce((i.rec).company_phone,         p.company_phone),
        company_email         = coalesce((i.rec).company_email,         p.company_email),
        sales_email           = coalesce((i.rec).sales_email,           p.sales_email),
        contact_name          = coalesce((i.rec).contact_name,          p.contact_name),
        contact_title         = coalesce((i.rec).contact_title,         p.contact_title),
        contact_phone         = coalesce((i.rec).contact_phone,         p.contact_phone),
        contact_linkedin      = coalesce((i.rec).contact_linkedin,      p.contact_linkedin),
        address               = coalesce((i.rec).address,               p.address),
        zip                   = coalesce((i.rec).zip,                   p.zip),
        tier                  = coalesce((i.rec).tier,                  p.tier),
        category              = coalesce((i.rec).category,              p.category),
        rating                = coalesce((i.rec).rating,                p.rating),
        review_count          = coalesce((i.rec).review_count,          p.review_count),
        source                = coalesce((i.rec).source,                p.source),
        seasonality_window    = coalesce((i.rec).seasonality_window,    p.seasonality_window),
        pipeline_notes        = coalesce((i.rec).pipeline_notes,        p.pipeline_notes),
        is_nonprofit          = coalesce((i.rec).is_nonprofit,          p.is_nonprofit),
        nonprofit_source      = coalesce((i.rec).nonprofit_source,      p.nonprofit_source),
        ein                   = coalesce((i.rec).ein,                   p.ein),
        priority_score        = coalesce((i.rec).priority_score,        p.priority_score),
        alt_fields            = coalesce((i.rec).alt_fields,            p.alt_fields),
        pipeline_last_seen_at = coalesce((i.rec).pipeline_last_seen_at, p.pipeline_last_seen_at)
    from inputs i
    where p.id = i.pid
    returning 1
)
select count(*)::int from updated;
$$;

-- PostgREST exposes any ``public.*`` function via ``/rpc/<name>`` to
-- roles that have EXECUTE on it. Service role already has it via the
-- ``postgres`` ownership chain; granting it explicitly to ``anon`` and
-- ``authenticated`` is intentionally NOT done — this function bypasses
-- the per-row UPDATE policy on ``prospects`` and must remain
-- pipeline-only (service-role key).
grant execute on function public.bulk_update_prospects(jsonb) to service_role;
revoke execute on function public.bulk_update_prospects(jsonb) from public, anon, authenticated;

comment on function public.bulk_update_prospects(jsonb) is
    'Bulk UPDATE for the supabase_sync pipeline phase. Takes a JSONB array '
    'of {id, patch} objects; each patch field is COALESCE''d against the '
    'existing column so unset fields preserve current values. Service-role '
    'only — bypasses per-row RLS on prospects.';
