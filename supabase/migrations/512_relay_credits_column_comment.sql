-- ============================================================================
-- `jobs.relay_credits` stores what the far end CHARGED, not what it reserved.
--
-- Migration 383 described the column as the far end's reserved credits (its
-- public `credits`). Since the far end started answering `credits_charged`
-- (#2168), the near end writes the settled charge — lower than the hold for a
-- run that used less, 0 for a refunded one — and falls back to the hold only
-- while the far hold is still open or when the far end predates the field
-- (backend/src/providers/nodaro/relay-cost.ts :: relayCreditsOf). The column
-- comment still said "reserved", which is what a reader of the schema sees.
--
-- Comment only: no column, row, balance or settlement changes.
-- ============================================================================

comment on column public.jobs.relay_credits is
  'Far-end charged credits for the relayed job: its public `credits_charged` once the hold has settled (0 when refunded), else its `credits` (the hold) while the hold is open or when the far end predates the field. Display units are derived locally via billing.unitRate; never sent over the wire.';
