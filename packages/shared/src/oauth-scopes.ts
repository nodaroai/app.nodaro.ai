/**
 * The OAuth scopes a Nodaro token can carry — part of the public API contract
 * (published in the authorization server's `scopes_supported`, requested by
 * developer apps, typed in `@nodaro/sdk`). The server validates against this
 * list and the SDK types against it, so the two cannot drift.
 *
 * A scope in this list is published and handed to any Dynamic Client
 * Registration client that asks for everything, so add one in the same change
 * that makes something check it (see backend/src/lib/scopes.ts).
 */
export const OAUTH_SCOPES = [
  "workflows:read",
  "workflows:write",
  "workflows:execute",
  "jobs:read",
  "assets:read",
  "assets:write",
  "credits:read",
  "apps:read",
  "pipelines:read",
  "pipelines:execute",
  "pipelines:approve",
  "presets:read",
  "workspaces:read",
  "workspaces:write",
] as const

export type OAuthScope = (typeof OAUTH_SCOPES)[number]
