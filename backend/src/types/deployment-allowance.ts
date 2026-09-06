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
  /**
   * When the current PERIOD began — the instant a `renew` last zeroed `spent`
   * — or absent when this allowance has never been renewed.
   *
   * OPTIONAL, and OMITTED rather than null when there is no period — the key
   * is either an ISO timestamp or absent, never present-and-null. Unlike
   * `spent`, "no value" is the truthful answer for an allowance that has never
   * turned over: `spent` is then a lifetime figure and a surface that printed
   * "this period" beside it would be wrong. Every renderer therefore asks
   * `resetAt ? "this period" : "total"`, and `resetAt ?? null` is the shape a
   * response body wants.
   */
  resetAt?: string
}

/**
 * How a row in `deployment_allowance_grants` came to exist.
 *
 * `granted_credits = Σ credits WHERE kind IN
 *  ('default','topup','correction','renewal')` is a reconcilable invariant.
 * `overrun` rows are AUDIT-ONLY and excluded from that sum: they record a
 * metered overrun that commit's clamp absorbed, and they never move
 * `granted_credits`.
 *
 * `renewal` is inside the sum because a renewal MOVES `granted_credits` to a
 * new target and its row carries the difference — which is the one kind whose
 * `credits` may legitimately be ZERO, so that a renewal at an unchanged plan
 * still leaves a row saying the period turned over.
 */
export type AllowanceGrantKind = "default" | "topup" | "correction" | "overrun" | "renewal"

/** One append-only audit row of a user's grant history. `credits` is raw and
 *  is negative only for `overrun`, `correction` and a downgrade at `renewal`. */
export interface AllowanceGrant {
  id: string
  credits: number
  kind: AllowanceGrantKind
  createdAt: string
  note: string | null
  /** The integration credential that performed the move, or null for the
   *  billing account's own browser session (the page). Audit only — the actor
   *  behind every row is still the payer. */
  credentialId: string | null
}

/** What `set_deployment_allowance` did. `noop` is a SUCCESS: the target was
 *  already the granted figure, which is what a replayed call must be. */
export type AllowanceApplied = "set" | "renew" | "noop"

/** How an integration named the user a verb is about. Subject first, email
 *  second, studio uuid accepted — the back office knows the identity its own
 *  IdP asserts, never the studio's uuid, until it has stored one. */
export interface UserRef {
  id?: string | null
  ssoSubject?: string | null
  email?: string | null
}

/**
 * The answer to "who is this?". `ambiguous` is a REFUSAL, never a guess: two
 * accounts answering to one address is a state the customer has to resolve,
 * and allocating a paid quota to an arbitrary half of it is the failure that
 * costs money. A lookup that could not be performed answers `ambiguous` too,
 * for the reason `sso-linking.ts` gives at its own `maybeSingle()` error
 * branch — "we cannot tell which account this address names" is never a
 * licence to act on one.
 */
export type ResolvedUserRef =
  | { kind: "user"; userId: string }
  | { kind: "absent" }
  | { kind: "ambiguous" }
