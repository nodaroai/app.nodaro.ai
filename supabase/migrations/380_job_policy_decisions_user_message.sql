-- 380 — the user-safe sentence a block/hold decision showed, so a RE-APPLY can
-- reproduce it verbatim.
--
-- THE HOLE THIS CLOSES (D13). `job_policy_decisions.reason` is MACHINE text —
-- `nsfw_score=0.98 label=explicit` — and D13 is explicit that it is for the
-- audit log alone: only a verdict's `userMessage` is ever shown to a user. But
-- 377 gave the table no column for that string, so when `job-policy-gate.ts`
-- re-applies a stored `block` against a row whose first attempt never landed
-- (the audit row is INSERTed before its CAS, so a crash in that window leaves a
-- verdict on record and a job still `processing`), the only sentence it could
-- reach for was `reason` — and it printed the policy's raw scores on the job
-- owner's canvas through `error_message` / `error_hint.reason`, both of which
-- are on PUBLIC_JOB_KEYS.
--
-- NULLABLE, and null is a real answer, not a gap:
--   * every row written before this migration (the gate falls back to the
--     PLATFORM's own sentence for those — never to `reason`);
--   * every `allow` / `flag` / `hold`, which show the user no sentence at all.
-- So the column reads as "what this decision put in front of the user, if
-- anything", which is exactly the question a re-apply asks.
--
-- LOCK: a nullable ADD COLUMN with no default is catalog-only (no rewrite, no
-- heap scan), and this table is small and service-role-only — nothing like
-- 377's note on `jobs`.
--
-- NO NEW GRANT. 377:101-104 REVOKEs ALL from PUBLIC/anon/authenticated and
-- GRANTs ALL to service_role at TABLE level, and there are no column-level
-- grants on this table — so a new column inherits that posture exactly:
-- service_role can read and write it, anon/authenticated can reach neither it
-- nor any other column. `supabase/tests/job-policy-hold-privacy.behavior.sql`
-- asserts that for this column by name, so a future permissive GRANT turns red.
ALTER TABLE public.job_policy_decisions
  ADD COLUMN IF NOT EXISTS user_message TEXT;

COMMENT ON COLUMN public.job_policy_decisions.user_message IS
  'USER-SAFE text this decision actually showed (error_message / error_hint.reason). NULL when the decision showed nothing (allow/flag/hold) or predates migration 380. NEVER derived from `reason`, which is machine text: re-applying a stored verdict reads THIS column and falls back to a platform-owned sentence, never to `reason` (D13).';

-- Two comments 377 left behind. Re-issued here rather than edited in place:
-- 377 is merged and already applied, so its text is history and only a new
-- COMMENT ON wins.

-- `applied` had only inline `--` prose in 377 (no COMMENT ON COLUMN at all),
-- and that prose is what drifted: NULL is a THIRD answer, not "not applicable".
COMMENT ON COLUMN public.job_policy_decisions.applied IS
  'Whether the verdict''s ACTION landed. NULL = not applicable (an allow/flag, and every request-gate row) OR not yet applied — the block/hold row is INSERTed BEFORE its CAS, so a crash in that window leaves NULL rather than a claim that never happened. TRUE = the action completed. FALSE = the CAS matched no row: a concurrent terminal writer won.';

-- 377:120-121 said "the non-column metered/meteredCost pair". It is FOUR keys,
-- not a pair, and `metered` is a boolean rather than a cost: the list is
-- HELD_COMMIT_REPLAY_KEYS in backend/src/lib/job-policy.ts, which
-- `splitHeldCompletionFields` is the single reader of.
COMMENT ON COLUMN public.jobs.held_completion_fields IS
  'The non-output columns the completion funnel computed (provider, provider_cost, display_cost, provider_task_id, plugin extras) plus the four non-column credit-settlement inputs HELD_COMMIT_REPLAY_KEYS names (metered, extraNonProviderCredits, meteredCost, loopTrimAddonRefundCredits), replayed verbatim on approve.';
