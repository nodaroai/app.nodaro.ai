-- ============================================================================
-- Workflow Copilot — publishing: the user's per-thread permission, and which
-- account a publish node uses when it does not name one.
--
-- Two columns, one index, no data migration. Both defaults are the behaviour
-- that already exists, so nothing changes for a row that is never touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-THREAD permission to author social-publishing nodes.
--
-- Per thread and not per user: the user is agreeing that THIS conversation may
-- build something that posts, which is a smaller and more legible thing to
-- agree to than a standing account-wide capability.
--
-- The default is the whole point. FALSE means an existing thread — and a thread
-- created by a server that has not been redeployed yet — cannot publish, which
-- is what "opt-in" has to mean. The backend reads it through
-- `threadAllowsPublishing`, which also treats an ABSENT column as false, so the
-- window between this landing on `main` and the code reaching production is
-- safe from both sides.
--
-- Note this lifts only the social publishers. `webhook-output` and the outbound
-- fetchers (web-scrape, rss-feed, …) stay denied for every thread regardless:
-- those name an arbitrary host in node data, and the harm ceiling is a user's
-- private media arriving at a server they never chose, not an unwanted post on
-- their own timeline. Enforced in `ee/copilot/tools/deny-lists.ts`, pinned by
-- `publish-exemption.test.ts`.
-- ----------------------------------------------------------------------------
ALTER TABLE public.copilot_threads
  ADD COLUMN IF NOT EXISTS allow_publishing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.copilot_threads.allow_publishing IS
  'The user allowed THIS thread to author social-publishing nodes. Never lifts webhook-output or the outbound fetchers, and never lets the model write a destination (connectionId / chatId / channel / platform) or the privacy field.';

-- ----------------------------------------------------------------------------
-- 2. Which connection a publish node uses when it names none.
--
-- `executePublish` already falls back to the user's connection for the platform
-- when `connectionId` is absent — and absent is exactly what the copilot's
-- destination lock guarantees, so "no connection named" IS how a copilot-built
-- node says "the user's default". That fallback is `limit(1)` with no ordering,
-- which for anyone holding two accounts on one platform means an ARBITRARY one:
-- a real bug today, independent of the copilot, and the reason this column is
-- not merely cosmetic.
--
-- Default FALSE for every existing row, deliberately. Back-filling one per
-- platform would pick for people who have not chosen, and the picker they have
-- not seen yet is exactly where that choice belongs. Until then the caller
-- falls back to oldest-first, which is at least deterministic.
-- ----------------------------------------------------------------------------
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.social_connections.is_default IS
  'The account this user publishes to on this platform when a node names no connection. At most one per (user_id, platform).';

-- One default per user per platform. PARTIAL, so the many non-default rows are
-- unconstrained — a user may hold any number of accounts per platform, they
-- just cannot have two defaults.
CREATE UNIQUE INDEX IF NOT EXISTS social_connections_one_default_per_platform
  ON public.social_connections (user_id, platform)
  WHERE is_default;
