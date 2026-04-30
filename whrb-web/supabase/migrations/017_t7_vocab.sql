-- 017_t7_vocab.sql — Stage T7 vocabulary audit-trail.
--
-- Plan: gleaming-dawn §9.5 — "Vocab pre-approval: as with T6, batch-approve
-- all new tag values before merge."
--
-- The T7 batch (22 new sources spanning bulk-CSV opens, grant lists,
-- trade associations, and Mass Save HPIN) reuses the existing T1 + T6
-- vocab — every emitted (axis, value) already lives in seed_tags.sql.
-- This migration is therefore a no-op INSERT (every row already exists)
-- and serves as the manifest-referenced "admin-approval migration
-- reference" for the auto-generated per-source integrity tests.
--
-- Idempotent: every insert is ``on conflict (axis, value) do nothing``.
-- Safe to re-run; produces zero new rows on a healthy DB.

-- T7 surface — exact vocab values referenced by the new source modules.
-- Listed here (rather than referenced indirectly) so a future audit can
-- confirm the surface area.
insert into public.tag_vocabulary (axis, value, status) values
  -- analyze_boston_extras.py / cambridge_permits.py / sec_adv.py /
  -- mass_save_hpin.py / ma_arborists.py / ma_landscape_pros.py /
  -- ma_dpu_movers.py — home services + cadence + sector hooks.
  ('sector',          'home_services',     'active'),
  ('sector',          'hospitality',       'active'),
  ('sector',          'finance',           'active'),
  ('sector',          'medical',           'active'),
  ('sector',          'education',         'active'),
  ('sector',          'arts',              'active'),
  ('sector',          'nonprofit',         'active'),
  ('sector',          'retail',            'active'),
  ('sector',          'technology',        'active'),
  ('sector',          'real_estate',       'active'),
  ('operating_model', 'service_provider',  'active'),
  ('operating_model', 'institution',       'active'),
  ('operating_model', 'venue',             'active'),
  ('operating_model', 'presenter',         'active'),
  ('operating_model', 'retailer',          'active'),
  ('cadence',         'year_round',        'active'),
  ('cadence',         'admissions_window', 'active'),
  ('cadence',         'term_driven',       'active'),
  ('cadence',         'seasonal_spring',   'active'),
  ('cadence',         'seasonal_summer',   'active'),
  ('cadence',         'seasonal_fall',     'active'),
  ('cadence',         'move_window',       'active'),
  ('affiliation',     'cambridge_based',   'active'),
  ('affiliation',     'boston_based',      'active'),
  ('affiliation',     'greater_boston',    'active'),
  ('affiliation',     'new_england_regional', 'active'),
  ('history',         'hpin_certified',    'active')
on conflict (axis, value) do nothing;
