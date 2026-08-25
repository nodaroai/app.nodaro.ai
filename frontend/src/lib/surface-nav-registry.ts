import type { NavKey } from "./surface-profile"

/**
 * Which routes a nav entry gates — the orphan guard checks these stay reachable
 * under the stock profile. Every NavKey is present (empty array = the nav entry
 * gates no route in this build). This is the tutorials-incident guard: hiding a
 * nav entry must never silently strand a whole subsystem, so every route that
 * belongs to a hideable surface is enumerated here rather than discovered when a
 * deployment hides its entry.
 */
export const NAV_ENTRY_ROUTES: Record<NavKey, string[]> = {
  gallery: ["/gallery", "/_gallery"],
  explore: ["/explore"],
  pricing: ["/pricing", "/_pricing"],
  templates: ["/templates"],
  apps: ["/apps", "/apps/deleted", "/apps/:appId/analytics"],
  community: [],
}

/**
 * Routes reachable only by a direct link (never from a hideable nav entry) —
 * exempt from the orphan guard. Every `path:` literal in router.tsx must be here
 * or in NAV_ENTRY_ROUTES; `surface-orphan-guard.test.ts` fails the build
 * otherwise. Kept explicit so a new route is a conscious classification.
 */
export const ENTRY_BY_LINK: readonly string[] = [
  // Framework / entry / auth — no surface nav entry leads here.
  "/",
  "*",
  "/login",
  "/signup",
  "/auth/callback",
  "/sso",
  "/auth/cli",
  "/setup",
  "/checkout-complete",
  "/oauth/authorize",
  "/mcp",

  // Public share/embed surfaces — reached by a link someone was handed.
  "/present/:shareToken",
  "/app/:slug",
  "/embed/:slug",
  "/tutorials/:slug",

  // Core app (dashboard) — the default landing, not gated by a surface nav entry.
  "/projects",
  "/projects/:id",
  "/projects/:id/workflows/:workflowId",
  "/Pipeline",
  "/Pipeline/:pipelineId",
  "/video-director",
  "/executions",
  "/archived-runs",
  "/my-files",
  "/library/locations",
  "/integrations",
  "/billing",
  "/settings",
  "/settings/api",
  "/settings/developer-apps",
  "/settings/developer-apps/:id",

  // Organizations axis — gated by org membership / hasOrganizations(), not a nav entry.
  "/join",
  "/join/:token",
  "/org/new",
  "/w/:id",
  "/org/:slug",
  "/org/:slug/members",
  "/org/:slug/workspaces",
  "/org/:slug/settings",
  "/org/:slug/audit",
  "/w/:id/people",
  "/w/:id/settings",

  // Admin — the parent plus its relative child paths (no leading slash), gated by
  // hasAdmin(), never by a surface nav entry.
  "/admin",
  "users",
  "jobs",
  "usage",
  "alerts",
  "models",
  "reports",
  "community-reports",
  "pricing",
  "settings",
  "miniapps",
  "minapps",
  "apps",
  "credit-audit",
  "credit-anomalies",
  "picker-gaps",
  "kie-credits",
  "subscriptions",
  "llm-models",
  "node-defaults",
  "tutorial-categories",
  "tutorials",
  "stuck-pipelines",
  "organizations",
  "client-apps",
  "app-reports",
]
