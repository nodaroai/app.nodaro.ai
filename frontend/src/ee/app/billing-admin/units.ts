/**
 * The billing-account page's pure arithmetic and formatting (Track A, WS6).
 *
 * Pure on purpose: everything here is a rule the SERVER also enforces, and a
 * rule that exists in two places must be testable in the cheap one. Nothing in
 * this file talks to the network, to react-query or to the DOM.
 *
 * R3 — NO CONVERSION HAPPENS HERE. Every per-user figure the page renders was
 * converted by the backend's one seam (`toUnits`), and every figure the page
 * SENDS travels in display units for the backend to convert back. The only
 * arithmetic below is the whole-credits VALIDATION, which divides by the rate
 * to ask "is this expressible as an integer number of Nodaro credits?" and
 * throws the quotient away.
 */

/** The deployment's display unit, exactly as `/overview` reports it. `null`
 *  means the profile carries no unit trio — the server refuses every `units`
 *  input in that state, so the page must too. */
export interface DisplayUnit {
  readonly label: string
  readonly rate: number
  readonly decimals: number
}

export type UnitsInputError =
  | "empty"
  | "not_a_number"
  | "zero"
  | "negative"
  | "not_whole_credits"
  | "unit_not_configured"

/**
 * The client-side mirror of `creditsFromUnits` in
 * `backend/src/ee/routes/deployment-billing.ts`. Returns `null` when the value
 * is acceptable, else the reason.
 *
 * The whole-credits rule is the load-bearing half and the reason this is a
 * mirror rather than a nicety: the ledger is an INTEGER column of Nodaro
 * credits, so a unit figure that does not divide by `unitRate` has no
 * representation there. The server 400s; doing the same check here means the
 * payer learns the granularity while typing instead of after submitting.
 *
 * `allowNegative` is the correction lane (Q6): the payer may LOWER an
 * allowance, and the database refuses — never trims — a correction that would
 * fall below what is already reserved or spent.
 */
export function unitsInputError(
  raw: string,
  unit: DisplayUnit | null,
  opts: { allowNegative?: boolean } = {},
): UnitsInputError | null {
  if (unit === null) return "unit_not_configured"
  const trimmed = raw.trim()
  if (trimmed === "") return "empty"
  // `Number()` accepts "1e3" and " 12 "; the ledger wants a plain integer, so
  // the shape is checked before the value.
  if (!/^-?\d+$/.test(trimmed)) return "not_a_number"
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return "not_a_number"
  if (value === 0) return "zero"
  if (value < 0 && !opts.allowNegative) return "negative"
  if (value % unit.rate !== 0) return "not_whole_credits"
  return null
}

/** A whole-dollar amount inside the platform's load range, or null. */
export function dollarsInputError(raw: string, min: number, max: number): "invalid" | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return "invalid"
  const value = Number(trimmed)
  return value >= min && value <= max ? null : "invalid"
}

/**
 * A figure, or an em dash.
 *
 * `null`/`undefined` mean "not available" — the read failed, or enforcement is
 * not on yet — and must NOT collapse to 0. On an allowance, 0 is a real value
 * that means "exhausted, this person cannot generate": manufacturing it turns
 * a missing read into a refusal on screen. A real 0 still renders as "0".
 */
export function orDash(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString()
}

/** Whole-number parse for a validated input (call only after the matching
 *  `*InputError` returned null). */
export function parseWhole(raw: string): number {
  return Number(raw.trim())
}
