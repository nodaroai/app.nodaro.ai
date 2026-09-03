-- PR9 safety-block handling (spec 2026-09-03-pr9-safety-block-handling).
--
-- WHY A NEW COLUMN. `jobs.error_detail` (migration 368) is the redacted raw
-- provider error — operator-only, never granted to authenticated. Neither it
-- nor the sanitized `error_message` string is machine-readable: the editor and
-- MCP need a STRUCTURED, USER-SAFE hint to decide whether to offer a fallback
-- provider after a stochastic safety-filter block (backend/src/lib/safety-block.ts),
-- without parsing prose or leaking provider internals.
--
-- WHAT LANDS HERE. `{ kind: "safety-block", class: "copyright"|"likeness"|"safety",
-- retried: boolean, suggestedProvider?: string }`, written by the video worker
-- alongside `error_message`/`error_detail` on a content-policy failure. NULL
-- for most failures (anything that isn't a classified content-policy block).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS error_hint jsonb;

COMMENT ON COLUMN public.jobs.error_hint IS
  'User-safe, machine-readable hint attached to a failure: {kind, class, retried, suggestedProvider}. NULL for most failures.';
