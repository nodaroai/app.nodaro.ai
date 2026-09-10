import type { DeveloperApp } from "@nodaro/sdk"

/**
 * Per-user cap on hand-registered developer apps. Mirrors
 * `MAX_APPS_PER_USER` in `backend/src/routes/developer-apps.ts`.
 */
export const MAX_APPS_PER_USER = 5

/** The only kind that counts toward the cap — an app a person registered. */
export const CAPPED_APP_KIND = "user"

/**
 * Apps that count toward the cap. MCP clients that register themselves
 * (`dynamic_mcp`) share the owner's list but never count; a server that
 * predates the `kind` field reports nothing, which is read as `user`.
 */
export function countCappedApps(apps: ReadonlyArray<Pick<DeveloperApp, "kind">>): number {
  return apps.filter((a) => (a.kind ?? CAPPED_APP_KIND) === CAPPED_APP_KIND).length
}

/**
 * The whole rule, as the page applies it: admins are never capped; everyone
 * else is capped on hand-registered apps only. Mirrors the server.
 */
export function isCapReached(apps: ReadonlyArray<Pick<DeveloperApp, "kind">>, opts: { isAdmin: boolean }): boolean {
  return !opts.isAdmin && countCappedApps(apps) >= MAX_APPS_PER_USER
}
