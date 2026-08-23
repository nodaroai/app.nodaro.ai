export const ALL_SCOPES = [
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
  // Workspaces. Deliberately NOT grandfathered onto existing grants: a token
  // issued before organizations existed was consented to by someone who
  // could not have been agreeing to let an app choose where their work
  // lands. Both are ENFORCED — the MCP workspace tools refuse to register
  // without them.
  //
  // `organizations:read` and `members:write` are deliberately ABSENT until
  // something checks them. A scope in this list is published in
  // `scopes_supported` and handed to any DCR client that asks for
  // everything, so declaring one early would authorize every token issued in
  // the meantime for a capability that did not exist yet — the same
  // grandfathering this comment exists to avoid, moved forward in time
  // instead of back. The organization ROUTES are also not scope-checked at
  // all yet: enforcement here is opt-in per route, those routes live in the
  // private plugin, and the plugin's request type carries `userId` and
  // nothing else, so it cannot see `req.appAuthorization`. Closing that
  // needs the toolkit request type widened in BOTH repos with the app-side
  // change merged FIRST (see backend/CLAUDE.md on plugin-version ordering),
  // and which scope each route requires is a product decision. Add the two
  // scopes back in the same change that makes them mean something.
  "workspaces:read",
  "workspaces:write",
] as const

export type Scope = typeof ALL_SCOPES[number]

const ALL_SCOPES_SET = new Set<string>(ALL_SCOPES)

export function isValidScope(s: string): s is Scope {
  return ALL_SCOPES_SET.has(s)
}

export function parseScopeString(s: string): Scope[] {
  const parts = s.split(/\s+/).filter((p) => p.length > 0)
  const out = new Set<Scope>()
  for (const p of parts) {
    if (!isValidScope(p)) {
      throw new Error(`Unknown scope: ${p}`)
    }
    out.add(p)
  }
  return [...out]
}

export function formatScopeString(scopes: readonly string[]): string {
  return scopes.join(" ")
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required)
}

export interface ScopeError {
  statusCode: 403
  body: { error: { code: "insufficient_scope"; message: string; missingScope: Scope } }
}

/**
 * Returns null if the scope is granted, otherwise a ready-to-send error response.
 * Routes call: `const err = requireScope(req.appAuthorization?.scopes ?? [], "workflows:execute"); if (err) return reply.status(err.statusCode).send(err.body)`.
 */
export function requireScope(granted: readonly string[], required: Scope): ScopeError | null {
  if (hasScope(granted, required)) return null
  return {
    statusCode: 403,
    body: { error: { code: "insufficient_scope", message: `Missing required scope: ${required}`, missingScope: required } },
  }
}
