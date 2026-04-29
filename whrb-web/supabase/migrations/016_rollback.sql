-- 016_rollback.sql — Reverse of 016_t6_vocab.sql.
--
-- Soft-delete: flip the five T6-introduced affiliation values to
-- ``deprecated`` rather than DROPing the rows. Hard delete would cascade
-- through prospect_tags via the FK, which is destructive. Per plan
-- §1.3 #25's source-lifecycle convention, deprecation is the right
-- gesture for vocab values that may still be referenced.
--
-- Idempotent.

update public.tag_vocabulary
   set status = 'deprecated', updated_at = now()
 where axis = 'affiliation'
   and value in (
     'berklee_affiliated',
     'nec_affiliated',
     'longy_affiliated',
     'bu_affiliated',
     'yale_affiliated'
   );
