import { randomUUID } from "node:crypto"
import { SignJWT } from "jose"
import type { FastifyInstance } from "fastify"
import { oauthMemorySupabase, type OAuthMemoryDb, type Row } from "./oauth-memory-db.js"
import { JWT_BEARER } from "./oauth-token-transcript.js"

/**
 * What the booted tests of the MCP assertion exchange share
 * (oauth-assertion-exchange*.test.ts): an in-memory Redis, so the browser
 * sign-in and the exchange claim their jtis in ONE real store (the real
 * `claimAssertionJti`), and the exchange's limiters count for real; the
 * Supabase auth admin calls account resolution makes (`resolveSsoUser`:
 * read, create, stamp an account; the sign-in's one-time login link), over
 * the memory database's `profiles`; and an assertion signer. Every secret
 * here is an obvious fake. Reads nothing from disk.
 */

export const SSO_SECRET = "test-only-sso-hmac-secret-not-real"
export const SIGN_IN_AUDIENCE = "nodaro-sign-in"
export const EXCHANGE_AUDIENCE = "nodaro-mcp-exchange"
export const PROVIDER_ID = "chat"

/** The EXTERNAL_SSO_PROVIDERS value: one assertion provider with both audiences. */
export const PROVIDERS_JSON = JSON.stringify([
  { id: PROVIDER_ID, label: "Chat", kind: "assertion", secret: SSO_SECRET, audience: SIGN_IN_AUDIENCE, exchangeAudience: EXCHANGE_AUDIENCE, maxLifetimeSeconds: 300 },
])

const key = new TextEncoder().encode(SSO_SECRET)

export interface AssertionOptions {
  aud?: string | string[]
  email?: string
  emailVerified?: boolean
  sub?: string
  jti?: string | null
  expiresIn?: string | number
  iat?: number
  secret?: string
}

/** A signed assertion the way the deployment's provider would mint one. */
export async function signAssertion(opts: AssertionOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = { email: opts.email ?? "new.person@example.com", email_verified: opts.emailVerified ?? true, sub: opts.sub ?? "idp-new-person" }
  let b = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt(opts.iat).setAudience(opts.aud ?? EXCHANGE_AUDIENCE).setExpirationTime(opts.expiresIn ?? "2m")
  if (opts.jti !== null) b = b.setJti(opts.jti ?? randomUUID())
  return b.sign(opts.secret ? new TextEncoder().encode(opts.secret) : key)
}

/** A Redis stand-in with the four commands the jti store and the limiters use; `fail` makes every command throw. */
export function memoryRedis() {
  const store = new Map<string, { value: string; ttl: number }>()
  const state = { fail: false }
  const guard = () => {
    if (state.fail) throw new Error("redis unreachable")
  }
  return {
    store,
    state,
    redis: {
      set: async (k: string, v: string, _ex?: string, ttl?: number, nx?: string) => {
        guard()
        if (nx === "NX" && store.has(k)) return null
        store.set(k, { value: v, ttl: ttl ?? -1 })
        return "OK"
      },
      incr: async (k: string) => {
        guard()
        const e = store.get(k) ?? { value: "0", ttl: -1 }
        e.value = String(Number(e.value) + 1)
        store.set(k, e)
        return Number(e.value)
      },
      ttl: async (k: string) => {
        guard()
        return store.get(k)?.ttl ?? -2
      },
      expire: async (k: string, ttl: number) => {
        guard()
        const e = store.get(k)
        if (e) e.ttl = ttl
        return 1
      },
    },
  }
}

export interface AuthUser {
  id: string
  email: string
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
}

export interface ExchangeHarness {
  /** The stand-in client a test's `vi.mock("…/lib/supabase.js")` returns. */
  supabase: unknown
  users: Map<string, AuthUser>
  /** Every account the code under test created, in order. */
  created: AuthUser[]
  seedAccount: (over: Partial<AuthUser> & { email: string }) => AuthUser
}

/**
 * The memory Supabase plus the auth admin API. Creating an account adds its
 * `profiles` row (the `handle_new_user` trigger's job) with the address.
 */
export function exchangeSupabase(db: OAuthMemoryDb): ExchangeHarness {
  const base = oauthMemorySupabase(db)
  const users = new Map<string, AuthUser>()
  const created: AuthUser[] = []
  const admin = {
    getUserById: async (id: string) => {
      const user = users.get(id)
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "not found" } }
    },
    createUser: async (attrs: { email: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) => {
      const user: AuthUser = { id: randomUUID(), email: attrs.email, user_metadata: attrs.user_metadata ?? {}, app_metadata: attrs.app_metadata ?? {} }
      users.set(user.id, user)
      created.push(user)
      db.profiles.push({ id: user.id, email: attrs.email, role: null })
      return { data: { user }, error: null }
    },
    updateUserById: async (id: string, attrs: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) => {
      const user = users.get(id)
      if (!user) return { data: { user: null }, error: { message: "not found" } }
      Object.assign(user.user_metadata, attrs.user_metadata ?? {})
      Object.assign(user.app_metadata, attrs.app_metadata ?? {})
      return { data: { user }, error: null }
    },
    generateLink: async () => ({ data: { properties: { hashed_token: "one-time-login-token" } }, error: null }),
  }
  /** Seeds an account that already exists: its auth record and its `profiles` row. */
  const seedAccount = (over: Partial<AuthUser> & { email: string }): AuthUser => {
    const user: AuthUser = { id: randomUUID(), user_metadata: {}, app_metadata: {}, ...over }
    users.set(user.id, user)
    db.profiles.push({ id: user.id, email: user.email, role: null })
    return user
  }
  return { supabase: { ...base, auth: { ...base.auth, admin } }, users, created, seedAccount }
}

/** POST /v1/oauth/token with the jwt-bearer grant, form-encoded as RFC 7523 shows it. */
export function exchangeRequest(app: FastifyInstance, fields: Record<string, string | undefined>, opts: { host?: string; query?: string } = {}) {
  const body = new URLSearchParams()
  body.set("grant_type", JWT_BEARER)
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.set(k, v)
  return app.inject({
    method: "POST",
    url: `/v1/oauth/token${opts.query ?? ""}`,
    headers: { "content-type": "application/x-www-form-urlencoded", ...(opts.host ? { host: opts.host } : {}) },
    payload: body.toString(),
  })
}

/** The rows of `db.tokens` the exchange wrote (its grant type). */
export function exchangedTokens(db: OAuthMemoryDb): Row[] {
  return db.tokens.filter((t) => t.grant_type === JWT_BEARER)
}
