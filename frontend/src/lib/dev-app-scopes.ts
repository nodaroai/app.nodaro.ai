import type { MessageKey } from "@/lib/i18n"

// Mirror of backend ALL_SCOPES (backend/src/lib/scopes.ts). Kept in sync
// manually — there is no shared package import on the frontend yet. This is the
// single source of truth for the developer-apps settings pages (list + detail),
// which previously each kept an identical copy of all three declarations.
export const ALL_SCOPES = [
  "workflows:read",
  "workflows:write",
  "workflows:execute",
  "jobs:read",
  "assets:read",
  "assets:write",
  "credits:read",
  "apps:read",
] as const

export type Scope = (typeof ALL_SCOPES)[number]

// Values are message keys, translated at the render site (a module-level map
// can't call the `t` hook).
export const SCOPE_DESCRIPTIONS: Record<Scope, MessageKey> = {
  "workflows:read": "devApps.scope.workflowsRead",
  "workflows:write": "devApps.scope.workflowsWrite",
  "workflows:execute": "devApps.scope.workflowsExecute",
  "jobs:read": "devApps.scope.jobsRead",
  "assets:read": "devApps.scope.assetsRead",
  "assets:write": "devApps.scope.assetsWrite",
  "credits:read": "devApps.scope.creditsRead",
  "apps:read": "devApps.scope.appsRead",
}
