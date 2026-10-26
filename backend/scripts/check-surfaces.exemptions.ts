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
 * Billing routes that answer a signed-in session only (`rejectProgrammaticAuth`
 * refuses every API key and app token): buying, the plan, the payment settings,
 * the receipts and the invoices. A first-party web app calls them through the
 * SDK with the person's own session; the CLI and an MCP client never hold one.
 */
const BILLING_SESSION_ONLY = [
  "GET /v1/billing/transactions",
  "POST /v1/billing/create-checkout-session",
  "POST /v1/billing/create-load-session",
  "GET /v1/billing/auto-recharge",
  "PUT /v1/billing/auto-recharge",
  "POST /v1/billing/manage-subscription",
  "POST /v1/billing/change-plan",
  "GET /v1/billing/payment-method",
  "GET /v1/billing/invoices",
] as const
const BILLING_SESSION_ONLY_REASONS = {
  cli: "the route answers a signed-in session only (buying, the plan and the payment settings are the person's own); the CLI signs in with an API key or app token, which it refuses by design. A web app calls it through the SDK",
  mcp: "an MCP client signs in with an app token, which the route refuses by design: buying, the plan and the payment settings are the person's own, never an agent's",
} as const
/**
 * The welcome offer's two writes answer a signed-in browser session only
 * (`rejectProgrammaticAuth`): the email consent they record is a person's
 * choice in a browser, which no token can make for them.
 */
const WELCOME_OFFER_SESSION_ONLY = ["POST /v1/credits/welcome-offer/claim", "POST /v1/credits/welcome-offer/seen"] as const
const WELCOME_OFFER_REASONS = {
  cli: "the route answers a signed-in browser session only, because the email consent it records is a person's choice in a browser; the CLI signs in with an API key or app token, which it refuses by design. A web app calls it through the SDK",
  mcp: "an MCP client signs in with an app token, which the route refuses by design: the email consent it records is a person's choice in a browser, never an agent's",
} as const
/** Why the gallery's moderation routes have no SDK method, MCP tool or REST docs entry. */
const GALLERY_MODERATION_REASONS: Readonly<Record<string, string>> = {
  "DELETE /v1/gallery/:p":
    "an administrator's moderation action (taking an item out of the public gallery), done from the app's admin gallery page; like the /v1/admin routes it is not part of the public API",
  "POST /v1/gallery/remove":
    "an administrator's moderation action (taking items out of the public gallery in bulk), done from the app's admin gallery page; like the /v1/admin routes it is not part of the public API",
  "POST /v1/gallery/report":
    "the web gallery's report button: a person viewing the public gallery flags an item for the moderators without signing in; the moderation queue is fed from that page, not by API clients or agents",
}
const PRESET_ORGANISATION =
  "preset folders, their order and bulk file import organise the editor's preset lists, which an agent has no use for; they are on the REST API, the SDK and the CLI"

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
  { feature: "presets", surface: "mcp", atom: "GET /v1/node-preset-groups", reason: PRESET_ORGANISATION },
  { feature: "presets", surface: "mcp", atom: "POST /v1/node-preset-groups", reason: PRESET_ORGANISATION },
  { feature: "presets", surface: "mcp", atom: "PATCH /v1/node-preset-groups/:p", reason: PRESET_ORGANISATION },
  { feature: "presets", surface: "mcp", atom: "DELETE /v1/node-preset-groups/:p", reason: PRESET_ORGANISATION },
  { feature: "presets", surface: "mcp", atom: "POST /v1/node-presets/reorder", reason: PRESET_ORGANISATION },
  { feature: "presets", surface: "mcp", atom: "POST /v1/node-presets/import", reason: PRESET_ORGANISATION },
  {
    feature: "presets",
    surface: "cli",
    atom: "POST /v1/node-presets/reorder",
    reason: "positions come from dragging presets in a list; a script that reorders uses the SDK's presets.reorder",
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
  ...(["cli", "mcp"] as const).flatMap((surface) =>
    WELCOME_OFFER_SESSION_ONLY.map((atom) => ({ feature: "credits", surface, atom, reason: WELCOME_OFFER_REASONS[surface] })),
  ),
  {
    feature: "credits",
    surface: "mcp",
    atom: "GET /v1/credits/history",
    reason: "a person's billing screen (every movement of the balance with the balance after each, filters, a CSV); an agent reads the same runs and purchases through credit_transactions",
  },
  {
    feature: "credits",
    surface: "mcp",
    atom: "GET /v1/credits/usage-summary",
    reason: "a person's analytics view (spend by model, over time, by session); an agent reads the runs through credit_transactions and sums what it needs",
  },
  ...BILLING_SESSION_ONLY.map((atom) => ({ feature: "billing", surface: "cli" as const, atom, reason: BILLING_SESSION_ONLY_REASONS.cli })),
  // The purchase history reaches agents through credit_transactions, which reads the same rows.
  ...BILLING_SESSION_ONLY.filter((atom) => atom !== "GET /v1/billing/transactions").map((atom) => ({
    feature: "billing",
    surface: "mcp" as const,
    atom,
    reason: BILLING_SESSION_ONLY_REASONS.mcp,
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
