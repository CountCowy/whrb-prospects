-- 017_rollback.sql — soft-deprecate T7's audit-trail vocab inserts.
--
-- Plan §1.3 #25: lifecycle is `active → sunset_proposed → sunset →
-- archived`; tag_vocabulary supports `active → deprecated` (no
-- hard-DELETE policy). Since 017_t7_vocab.sql only inserts rows that
-- already existed at T1/T6 seed time, this rollback is a strict no-op
-- — there is nothing to deprecate that the prior stages don't still
-- depend on.
--
-- Deliberately empty (one comment block + a single safe SELECT) so
-- ``apply_t7_migration.py --rollback`` exits cleanly without touching
-- shared vocab.

select 1 as t7_rollback_noop;
