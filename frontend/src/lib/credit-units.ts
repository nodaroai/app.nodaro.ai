import {
  surfaceCreditUnitLabel,
  surfaceCreditsToUnits,
} from "./surface-selectors"

/**
 * Credit figures in the DISPLAY unit (Phase B).
 *
 * Two kinds of credit figure reach the screen, and they must not be mixed up:
 *
 *  - CLIENT-computed Nodaro credits — NODE_CREDIT_COSTS, the run estimate,
 *    a balance from /v1/user/credits, `estimatedCredits` on a server row.
 *    These are raw and are converted HERE, once, at the render boundary
 *    (`creditUnits`), and labeled with the deployment's unit (`creditUnitLabel`).
 *    Gate inputs stay raw: the run precheck compares an estimate against the
 *    balance in Nodaro credits and converts only what it shows (H11).
 *
 *  - Figures that arrive from the billing seam already in the display unit —
 *    `/v1/jobs/cost-summary` and `/v1/billing/account` — and carry their own
 *    `unit`. Render those VERBATIM next to `serverUnitLabel(unit)`; never pass
 *    them through `creditUnits` (a second conversion) and never pair them with
 *    `creditUnitLabel()` (a label derived elsewhere).
 *
 * Unconfigured deployments get the mainline literals back unchanged: rate 1,
 * label "CR" (or the locale's short label the caller passes).
 */

/**
 * A client-computed credit figure in the display unit. `?? 0` is for
 * ESTIMATES only — a site whose value means "no estimate yet" — and is the
 * atom's long-standing contract. A figure the billing authority answered
 * must decide null → em-dash BEFORE calling this (§5.2 rule 1).
 */
export function creditUnits(credits: number | null | undefined): number {
  return surfaceCreditsToUnits(credits ?? 0) ?? 0
}

/**
 * The short unit label for a client-computed figure. `codeDefault` is what
 * the site rendered before the display unit existed (the locale's "CR" /
 * "קר׳"), so an unconfigured deployment is byte-identical.
 */
export function creditUnitLabel(codeDefault = "CR"): string {
  const configured = surfaceCreditUnitLabel()
  return configured === "CR" ? codeDefault : configured
}

/** `"12 CR"` — the two above, joined the way every hand-rolled site did. */
export function formatCreditUnits(
  credits: number | null | undefined,
  opts: { readonly label?: string; readonly localized?: boolean } = {},
): string {
  const n = creditUnits(credits)
  const figure = opts.localized ? n.toLocaleString() : String(n)
  return `${figure} ${creditUnitLabel(opts.label)}`
}

/**
 * The label for a figure the billing seam already converted. The provider's
 * own unit id (`"credits"`) is what the mainline nodaro-cloud provider reports
 * and maps to the short label a site used; anything else is the configured
 * display label and is rendered as-is.
 */
export function serverUnitLabel(unit: string | undefined, codeDefault = "CR"): string {
  if (!unit || unit === "credits") return codeDefault
  return unit
}
