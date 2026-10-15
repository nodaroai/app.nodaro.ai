/**
 * Intended gaps for `npm run check:surfaces`: a surface that a feature (or one
 * of its atoms) deliberately does not offer, with why.
 *
 * This list only shrinks. An exemption that no longer matches a gap is STALE
 * and fails `--strict`, so remove it once the gap is closed. Leave out `atom`
 * to exempt the whole surface for the feature — a reason is required either
 * way. Reasons say why the gap is intended; they are public text (this repo
 * is mirrored), so no names, dates or business numbers.
 *
 * Not listed here because the checker decides them itself: routes in the
 * admin / in-app-only / webhook / self-host / infra / plugin buckets, MCP
 * tools that call no route, local-only CLI commands, and generated docs.
 */
import type { Surface } from "./lib/check-surfaces/types.js"

export interface SurfaceExemption {
  /** Feature id: an SDK property path, `node:<type>`, `route:<segment>` or `_internal`. */
  feature: string
  surface: Surface
  /** `METHOD /v1/path` (parameters as `:p`) or `node:<type>`; omitted = every atom of the feature. */
  atom?: string
  reason: string
}

/**
 * Billing routes a signed-in browser session uses and every API or app token
 * is refused on (`rejectProgrammaticAuth`): buying, changing the plan, the
 * payment settings and the receipts stay in the Nodaro app.
 */
const BILLING_SESSION_ONLY = [
  "GET /v1/billing/transactions",
  "POST /v1/billing/create-checkout-session",
  "POST /v1/billing/create-load-session",
  "GET /v1/billing/auto-recharge",
  "PUT /v1/billing/auto-recharge",
  "POST /v1/billing/manage-subscription",
  "POST /v1/billing/change-plan",
] as const
const BILLING_SESSION_ONLY_REASON =
  "browser session only: buying, plan changes and payment settings happen in the Nodaro app, and the route refuses API and app tokens"

export const SURFACE_EXEMPTIONS: readonly SurfaceExemption[] = [
  {
    feature: "node:site-capture",
    surface: "node-doc-live",
    reason:
      "new node: the docs-site page is written and published once the node is in production; remove this entry, and the node's AWAITING_DOCS_PAGE row, when the node-docs snapshot is refreshed",
  },
  ...BILLING_SESSION_ONLY.map((atom) => ({ feature: "billing", surface: "sdk" as const, atom, reason: BILLING_SESSION_ONLY_REASON })),
  // The purchase history reaches agents through credit_transactions, which reads the same rows.
  ...BILLING_SESSION_ONLY.filter((atom) => atom !== "GET /v1/billing/transactions").map((atom) => ({
    feature: "billing",
    surface: "mcp" as const,
    atom,
    reason: BILLING_SESSION_ONLY_REASON,
  })),
  {
    feature: "billing",
    surface: "mcp",
    atom: "GET /v1/billing/plans",
    reason: "public pricing-page data for people choosing a plan, served by REST and the SDK; no agent task needs it",
  },
  {
    feature: "billing",
    surface: "mcp",
    atom: "GET /v1/billing/subscription",
    reason: "an agent reads the account's plan through check_balance (tier, effectiveTier)",
  },
  {
    feature: "billing",
    surface: "mcp",
    atom: "GET /v1/billing/account",
    reason: "an agent reads the balance and plan through check_balance",
  },
  {
    feature: "billing",
    surface: "mcp",
    atom: "GET /v1/billing/surface",
    reason: "how an app's own cost views display on this deployment; nothing an agent acts on",
  },
]
