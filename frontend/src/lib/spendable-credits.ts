/**
 * Track A (D12) — the ONE place that decides what a per-user allowance means to
 * the browser.
 *
 * Under a deployment payer three client surfaces used to answer this question
 * with three copies of the same expression, and a fourth (the per-node Generate
 * button) never asked it at all. This module is the single answer, because the
 * rule is not the obvious one and a copy of it drifts silently:
 *
 *   VISIBLE ≠ ENFORCED (ruling R-A). The server sends `allowance` from the
 *   moment a payer exists — that is what lets the sidebar stop rendering the
 *   requester's FROZEN signup grant at rollout step 5. It only ENFORCES that
 *   allowance once the deployment flips `billing.allowances` to `"enforce"`
 *   (step 8), and it says which by sending `allowance.enforced`.
 *
 * Getting that backwards is expensive in both directions:
 *
 *  - Gating on a visible-but-unenforced allowance refuses runs the payer's pool
 *    would have paid for. Step 5 promises "nothing enforces one yet, so nobody
 *    is refused"; a client that refuses anyway breaks the rollout's own order.
 *  - Displaying `total` under a payer shows the frozen signup grant — a number
 *    nothing debits and nothing tops up, so it neither blocks nor permits
 *    truthfully, and the payer's own top-up lever cannot move it.
 *
 * And there is NO third number that is safe to gate on inside that window,
 * which is why `gateApplies` exists. "Fall back to `total`" reads like the
 * conservative choice and is not one: on a payer instance `total` is that
 * frozen grant, so a payer granting 10,000 credits watched the per-node
 * Generate button stay disabled for a 4,000-credit node over a 1,500 it could
 * not move, and a user provisioned before any signup grant landed (`total: 0`)
 * got a permanently dead button. Between "a payer exists" and "enforcement is
 * on", the server — the payer's pool now, the RPC's allowance check after the
 * flip — is the ONLY thing entitled to refuse a run. A client precheck there
 * is a lie, so it does not happen.
 *
 * So one call answers three questions, and callers pick by what they are:
 * `gateApplies` says whether a GATE may compare at all, `figure` is what it
 * compares against when it may, and `displayFigure` is what a SCREEN shows.
 *
 * AND IT TAKES THE SURFACE FLAG, because `allowance: null` means TWO things
 * and the body cannot tell them apart: the caller IS the payer (D13), or the
 * figure was UNAVAILABLE (a read error, an unreadable settings row). Reading
 * the second as "no allowance ⇒ gate on `total`" put the pre-flip refusal
 * straight back on a payer instance the first time a read blipped — the exact
 * refusal ruling R-C removed — and the server's 15 s balance cache then held
 * it for every poll in that window. `billingSurface().deploymentPayer` is the
 * fact that separates them, and the client already has it.
 *
 * EVERYTHING HERE IS RAW NODARO CREDITS. `creditUnits` is a render conversion;
 * putting a display unit on either side of a gate's comparison is how a
 * relabelled instance turns into a money bug (H11).
 */

/** The allowance as `GET /v1/user/credits` sends it, in raw credits. */
export interface CreditAllowance {
  readonly granted: number
  readonly remaining: number
  /**
   * True only when the server will actually refuse a run that exceeds this
   * allowance (`billing.allowances: "enforce"`). ABSENT means "not enforced":
   * an unknown enforcement state is never read as enforced, so a backend that
   * predates this field is treated as the pre-flip window — visible allowance,
   * no client gate — rather than as licence to refuse.
   */
  readonly enforced?: boolean
}

/** The part of the balance body this decision needs. */
export interface BalanceWithAllowance {
  readonly total: number
  /** ABSENT on mainline (the key never travels). PRESENT and `null` under a
   *  payer when no allowance applies to this caller — they ARE the payer (D13,
   *  they hold the real credits rather than an allocation), or the figure was
   *  unavailable. Never read null as "remaining 0", and never read it as
   *  "gate on `total`" either: those two null cases are indistinguishable
   *  here, which is why `spendableCredits` takes the payer flag. */
  readonly allowance?: CreditAllowance | null
}

export interface SpendableCredits {
  /**
   * Whether a client-side gate may refuse a run at all — FALSE whenever the
   * only number on hand is the requester's frozen signup grant. A caller that
   * ignores this and compares `figure` anyway reintroduces the dead Generate
   * button.
   *
   * TRUE on mainline (no payer: `total` is the wallet every run debits) and on
   * an allowance the server says it ENFORCES (`remaining` is the number it
   * refuses on). FALSE on a payer instance otherwise — a visible-but-unenforced
   * allowance, and a `null` one alike, because null there is either the payer's
   * own exemption (D13) or an unavailable read, and neither licenses refusing
   * on the frozen grant.
   */
  readonly gateApplies: boolean
  /**
   * What a RUN GATE compares an estimate against WHEN `gateApplies` — the
   * allowance's `remaining` once the server says it is enforced, and `total`
   * otherwise — which on mainline is the pre-Track-A comparison, unchanged.
   *
   * It is still a real number when `gateApplies` is false (never `Infinity`,
   * never a manufactured ceiling — either would leak into a modal or a tooltip
   * as a figure the user reads); it is simply not one anybody may compare.
   */
  readonly figure: number
  /** Whether the allowance is the binding ceiling (see `CreditAllowance`). */
  readonly enforced: boolean
  /** The allowance as sent, for surfaces that render the granted/remaining
   *  pair. `null` means none applies — never "remaining 0". */
  readonly allowance: CreditAllowance | null
  /**
   * The headline number a DISPLAY surface shows. The visible allowance
   * whenever the server sent one — enforced or not, because R-A makes it
   * visible first — and `total` otherwise. NOT a gate input.
   *
   * It equals `figure` whenever `gateApplies`, which is why every screen,
   * modal and tooltip can take this one unconditionally and still quote the
   * number that refused the run.
   */
  readonly displayFigure: number
}

/**
 * @param balance the body `GET /v1/user/credits` sent.
 * @param deploymentPayer `billingSurface().deploymentPayer` — does THIS
 *   INSTANCE have a payer at all (deployment grain, not "am I the payer").
 *   It is consulted for one thing only: whether a NULL allowance may be gated
 *   on. Required rather than defaulted, so a new gate cannot forget it and
 *   quietly inherit mainline's answer.
 */
export function spendableCredits(
  balance: BalanceWithAllowance,
  deploymentPayer: boolean,
): SpendableCredits {
  const allowance = balance.allowance ?? null
  // Read the enforcement bit HERE and nowhere else: it is the one field whose
  // wire shape may still move, and every caller then moves with it.
  const enforced = allowance?.enforced === true
  return {
    allowance,
    enforced,
    // A PRESENT allowance answers on its own and never consults the flag: it
    // already proves a payer exists, and the flag comes from a cached
    // deployment-grain query that can be cold — deciding this case on a cold
    // `false` would put the pre-flip refusal back. `remaining` is not what the
    // server refuses on until it says `enforced`, and `total` under a payer is
    // the frozen grant, so the visible-but-unenforced window gates on nothing.
    //
    // A NULL (or absent) allowance is where the flag earns its place. On
    // mainline that is every response and `total` is the live wallet. On a
    // payer instance it is either the payer's own exemption (D13) or a figure
    // that could not be read — and `total` is the frozen grant in BOTH, so the
    // browser stands down and the server (the pool now, the RPC's allowance
    // check after the flip) is the only thing that refuses.
    gateApplies: allowance !== null ? enforced : !deploymentPayer,
    figure: allowance && enforced ? allowance.remaining : balance.total,
    displayFigure: allowance ? allowance.remaining : balance.total,
  }
}
