-- WHRB prospects — canonical tag vocabulary seed (Stage T1)
-- =========================================================================
-- Idempotent: every insert is `on conflict (axis, value) do nothing`. Safe
-- to re-run. Mirrors TAGS.md — if you change one, change the other.
--
-- The on_rep_tag_vocab_insert trigger forces non-admin authed inserts to
-- pending_admin_review, so this seed must be applied with the service-role
-- key (auth.uid() is null, trigger no-ops). scripts/t1_seed_vocab.py does
-- exactly that.
-- =========================================================================

-- 1) `unknown` placeholder in every axis (9 rows)
insert into public.tag_vocabulary (axis, value, status) values
  ('sector',         'unknown', 'active'),
  ('operating_model','unknown', 'active'),
  ('genre',          'unknown', 'active'),
  ('affiliation',    'unknown', 'active'),
  ('cadence',        'unknown', 'active'),
  ('daypart_fit',    'unknown', 'active'),
  ('history',        'unknown', 'active'),
  ('compliance',     'unknown', 'active'),
  ('other',          'unknown', 'active')
on conflict (axis, value) do nothing;

-- 2) affiliation (10 rows) — gleaming-dawn §1.3 #4
insert into public.tag_vocabulary (axis, value, status) values
  ('affiliation', 'harvard_affiliated',    'active'),
  ('affiliation', 'mit_affiliated',        'active'),
  ('affiliation', 'cambridge_based',       'active'),
  ('affiliation', 'boston_based',          'active'),
  ('affiliation', 'greater_boston',        'active'),
  ('affiliation', 'berkshires',            'active'),
  ('affiliation', 'cape_ann',              'active'),
  ('affiliation', 'new_england_regional',  'active'),
  ('affiliation', 'national',              'active'),
  ('affiliation', 'international',         'active')
on conflict (axis, value) do nothing;

-- 3) genre (13 rows) — gleaming-dawn §1.3 #5
insert into public.tag_vocabulary (axis, value, status) values
  ('genre', 'classical',     'active'),
  ('genre', 'choral',        'active'),
  ('genre', 'opera',         'active'),
  ('genre', 'jazz',          'active'),
  ('genre', 'world_music',   'active'),
  ('genre', 'folk',          'active'),
  ('genre', 'blues',         'active'),
  ('genre', 'country',       'active'),
  ('genre', 'rock_indie',    'active'),
  ('genre', 'dance',         'active'),
  ('genre', 'theatre',       'active'),
  ('genre', 'film',          'active'),
  ('genre', 'spoken_word',   'active')
on conflict (axis, value) do nothing;

-- 4) daypart_fit (6 rows) — derived in T2 but vocab seeded now so the
--    compute-on-read view can reference it without a migration race.
insert into public.tag_vocabulary (axis, value, status) values
  ('daypart_fit', 'classical',         'active'),
  ('daypart_fit', 'jazz',              'active'),
  ('daypart_fit', 'blues_hillbilly',   'active'),
  ('daypart_fit', 'record_hospital',   'active'),
  ('daypart_fit', 'darker_side',       'active'),
  ('daypart_fit', 'sports_news',       'active')
on conflict (axis, value) do nothing;

-- 5) sector (11 rows) — every value referenced with `sector:<v>` syntax
--    in plan §3.4–§10 (T2/T6/T7/T8 source emitter notes).
insert into public.tag_vocabulary (axis, value, status) values
  ('sector', 'arts',           'active'),
  ('sector', 'nonprofit',      'active'),
  ('sector', 'education',      'active'),
  ('sector', 'home_services',  'active'),
  ('sector', 'religious',      'active'),
  ('sector', 'finance',        'active'),
  ('sector', 'medical',        'active'),
  ('sector', 'retail',         'active'),
  ('sector', 'technology',     'active'),
  ('sector', 'hospitality',    'active'),
  ('sector', 'real_estate',    'active')
on conflict (axis, value) do nothing;

-- 6) operating_model (7 rows)
insert into public.tag_vocabulary (axis, value, status) values
  ('operating_model', 'ensemble',         'active'),
  ('operating_model', 'presenter',        'active'),
  ('operating_model', 'venue',            'active'),
  ('operating_model', 'festival',         'active'),
  ('operating_model', 'service_provider', 'active'),
  ('operating_model', 'retailer',         'active'),
  ('operating_model', 'institution',      'active')
on conflict (axis, value) do nothing;

-- 7) cadence (8 rows)
insert into public.tag_vocabulary (axis, value, status) values
  ('cadence', 'term_driven',        'active'),
  ('cadence', 'year_round',         'active'),
  ('cadence', 'admissions_window',  'active'),
  ('cadence', 'seasonal_spring',    'active'),
  ('cadence', 'seasonal_summer',    'active'),
  ('cadence', 'seasonal_fall',      'active'),
  ('cadence', 'seasonal_winter',    'active'),
  ('cadence', 'move_window',        'active')
on conflict (axis, value) do nothing;

-- 8) history (8 rows) — peer-radio + program-book + sector certs
insert into public.tag_vocabulary (axis, value, status) values
  ('history', 'wcrb_sponsor',         'active'),
  ('history', 'wgbh_sponsor',         'active'),
  ('history', 'wbur_sponsor',         'active'),
  ('history', 'wumb_sponsor',         'active'),
  ('history', 'wers_sponsor',         'active'),
  ('history', 'peer_public_radio',    'active'),
  ('history', 'program_book_sponsor', 'active'),
  ('history', 'hpin_certified',       'active')
on conflict (axis, value) do nothing;

-- 9) compliance (1 row beyond unknown). Cannabis is a hard block (plan
--    §1.3 #6) and is intentionally NOT in this vocab. Other compliance
--    categories (alcohol, gambling, etc.) are added by the relevant
--    T2+ source emitters when needed.
insert into public.tag_vocabulary (axis, value, status) values
  ('compliance', 'political', 'active')
on conflict (axis, value) do nothing;

-- 10) other axis: zero seeded values. Rep-created tags populate this axis
--     organically via the `tag_vocab_pending` flow.

-- =========================================================================
-- End of seed_tags.sql — 73 canonical rows
-- =========================================================================
