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
/** Why the gallery's moderation routes have no SDK method, MCP tool or REST docs entry. */
const GALLERY_MODERATION_REASONS: Readonly<Record<string, string>> = {
  "DELETE /v1/gallery/:p":
    "an administrator's moderation action (taking an item out of the public gallery), done from the app's admin gallery page; like the /v1/admin routes it is not part of the public API",
  "POST /v1/gallery/remove":
    "an administrator's moderation action (taking items out of the public gallery in bulk), done from the app's admin gallery page; like the /v1/admin routes it is not part of the public API",
  "POST /v1/gallery/report":
    "the web gallery's report button: a person viewing the public gallery flags an item for the moderators without signing in; the moderation queue is fed from that page, not by API clients or agents",
}

export const SURFACE_EXEMPTIONS: readonly SurfaceExemption[] = [
  // Connected apps answer a signed-in browser session only: an app must not
  // list or revoke the grants it lives under.
  {
    feature: "client",
    surface: "cli",
    atom: "GET /v1/me/connected-apps",
    reason:
      "the route answers a signed-in browser session only, and the CLI signs in with an API key or app token, which it refuses by design; the account's Connected apps settings (or the SDK in a browser app) list them",
  },
  {
    feature: "client",
    surface: "cli",
    atom: "POST /v1/me/connected-apps/:p/revoke",
    reason:
      "the route answers a signed-in browser session only, and the CLI signs in with an API key or app token, which it refuses by design; revoke from the account's Connected apps settings (or the SDK in a browser app)",
  },
  {
    feature: "client",
    surface: "mcp",
    atom: "GET /v1/me/connected-apps",
    reason:
      "an MCP client is itself a connected app, and the route answers a signed-in browser session only: an app must not list the grants it lives under",
  },
  {
    feature: "client",
    surface: "mcp",
    atom: "POST /v1/me/connected-apps/:p/revoke",
    reason:
      "an MCP client is itself a connected app, and the route answers a signed-in browser session only: an app must not revoke grants, its own or another's",
  },
  {
    feature: "characters",
    surface: "mcp",
    atom: "DELETE /v1/characters/:p/lora",
    reason:
      "removing a trained model destroys a paid training and cannot be undone, and the MCP tools create and modify, they never delete; over REST, the SDK or the CLI it takes assets:write for an app token, like deleting the character",
  },
  {
    feature: "webhooks",
    surface: "mcp",
    reason:
      "registering a webhook endpoint returns its signing secret once and sets up account-wide delivery of job events to a server: an app or CLI action, not an AI-agent one",
  },
  {
    feature: "palettes",
    surface: "mcp",
    atom: "DELETE /v1/palettes/:p",
    reason: "deleting a palette is destructive and makes every run that names it fail: a person does it in the app, the CLI or the API, never an agent",
  },
  {
    feature: "palettes",
    surface: "mcp",
    atom: "GET /v1/palettes/:p",
    reason: "list_palettes already answers every field of every palette (its name, colours and note), so reading one by id would add nothing for an agent",
  },
  {
    feature: "moodboards",
    surface: "mcp",
    atom: "DELETE /v1/moodboards/:p",
    reason: "deleting a moodboard is destructive and makes every run that names it fail: a person does it in the app, the CLI or the API, never an agent",
  },
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
  ...(["sdk", "mcp", "api-doc"] as const).flatMap((surface) =>
    Object.entries(GALLERY_MODERATION_REASONS).map(([atom, reason]) => ({ feature: "gallery", surface, atom, reason })),
  ),
]
