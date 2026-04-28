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
  body: { error: { code: "insufficient_scope"; message: string } }
}

/**
 * Returns null if the scope is granted, otherwise a ready-to-send error response.
 * Routes call: `const err = requireScope(req.appAuthorization?.scopes ?? [], "workflows:execute"); if (err) return reply.status(err.statusCode).send(err.body)`.
 */
export function requireScope(granted: readonly string[], required: Scope): ScopeError | null {
  if (hasScope(granted, required)) return null
  return {
    statusCode: 403,
    body: { error: { code: "insufficient_scope", message: `Missing required scope: ${required}` } },
  }
}
