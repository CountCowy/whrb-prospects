-- 016_t6_vocab.sql — Stage T6 vocabulary additions.
--
-- Plan: gleaming-dawn §8.4 — "admins pre-approve the full set of new tag
-- vocab values used by these sources before T6 merges (avoids the
-- pending-review flood on first pipeline run)".
--
-- The T6 source batch introduces six scrapers (Harvard / arts associations
-- / corporate sponsor pages / ArtsBoston calendar / church concerts /
-- music school departments). Most tags they emit (sector:arts,
-- operating_model:ensemble, genre:classical, etc.) already live in the
-- T1 seed. The five new institution-specific affiliation values added
-- here — berklee_affiliated, nec_affiliated, longy_affiliated,
-- bu_affiliated, yale_affiliated — are required by
-- ``music_school_departments.py`` and have no T1 seed.
--
-- Idempotent: every insert is ``on conflict (axis, value) do nothing``.
-- Safe to re-run.

insert into public.tag_vocabulary (axis, value, status) values
  ('affiliation', 'berklee_affiliated', 'active'),
  ('affiliation', 'nec_affiliated',     'active'),
  ('affiliation', 'longy_affiliated',   'active'),
  ('affiliation', 'bu_affiliated',      'active'),
  ('affiliation', 'yale_affiliated',    'active')
on conflict (axis, value) do nothing;
