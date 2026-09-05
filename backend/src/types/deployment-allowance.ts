/**
 * Track A — the per-user deployment allowance, as the rest of the backend
 * sees it.
 *
 * EVERY number in this file is RAW NODARO CREDITS. Display units — the
 * deployment's own unit label, ×`unitRate` — exist at exactly two boundaries:
 * route input, where they are validated as a whole number of credits, and
 * render, through `lib/billing-display-unit.ts`'s `toUnits`. Nothing in
 * between converts, because the ledger, the RPC's enforcement block and
 * `pricing.creditCost` are all in credits: a unit that reached the ledger
 * would make every stored balance wrong the day `unitRate` moves.
 *
 * The allowance itself is a QUOTA AGAINST SOMEONE ELSE'S POOL, never money.
 * Nodaro's real exposure is bounded by the deployment payer's credits, which
 * `reserve_credits` already enforces atomically; an exhausted allowance
 * protects nobody's balance. Nothing that renders these types may imply
 * otherwise.
 */

/**
 * One requester's allowance. `remaining = granted − reserved − spent`, clamped
 * at 0.
 *
 * A user who has never generated has NO row (provisioning is lazy, at the
 * first enforced reserve — D7), and every read surface must still answer
 * `granted = remaining = default_allowance_credits` for them. That rule lives
 * in exactly one place, `ee/billing/deployment-allowance-service.ts`; a
 * consumer that queries `deployment_user_allowances` directly would
 * re-implement it, get it wrong, and refuse a brand-new user's first Generate.
 */
export interface UserAllowance {
  /** The user's total allocation — the default plus every top-up (D17). */
  granted: number
  /** What is left to reserve right now. Never negative. */
  remaining: number
  /** Settled consumption — `spent_credits`, NOT `granted − remaining`, which
   *  also contains `reserved` (a job still running). Required, not optional:
   *  a user with no row has truthfully spent 0, and an absent field would
   *  render as an em dash where a real 0 belongs. */
  spent: number
}

/**
 * How a row in `deployment_allowance_grants` came to exist.
 *
 * `granted_credits = Σ credits WHERE kind IN ('default','topup','correction')`
 * is a reconcilable invariant. `overrun` rows are AUDIT-ONLY and excluded from
 * that sum: they record a metered overrun that commit's clamp absorbed, and
 * they never move `granted_credits`.
 */
export type AllowanceGrantKind = "default" | "topup" | "correction" | "overrun"

/** One append-only audit row of a user's grant history. `credits` is raw and
 *  is negative only for `overrun` and `correction`. */
export interface AllowanceGrant {
  id: string
  credits: number
  kind: AllowanceGrantKind
  createdAt: string
  note: string | null
}
