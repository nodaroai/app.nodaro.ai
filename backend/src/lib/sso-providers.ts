import { z } from "zod"
import { readFileSync } from "node:fs"
import { config } from "./config.js"

/**
 * External SSO provider registry (B6) — CORE auth, root SUL.
 *
 * Data-driven: the trusted IdP list is env config (EXTERNAL_SSO_PROVIDERS),
 * not code. Fail-LOUD by design: unlike the surface profile's element-wise
 * `.catch` degrade, a malformed SECRET-BEARING auth entry must abort boot, not
 * silently vanish (a dropped provider = SSO mysteriously 404s, and a
 * half-parsed one is a security hole). Same stance as config.ts's throw.
 */

export type SsoProviderKind = "assertion" | "oidc" | "saml"

export interface AssertionClaimMap {
  email: string
  emailVerified: string
  subject: string
}

export interface SsoProviderConfig {
  id: string
  label: string
  kind: SsoProviderKind
  /** HS256 HMAC key — REQUIRED for kind="assertion". A dedicated secret, never
   *  the IdP's own session secret (a Nodaro compromise must not forge IdP
   *  sessions — §5.6 rule 2). */
  secret?: string
  /** Expected `aud` claim — REQUIRED for kind="assertion". */
  audience?: string
  claimMap: AssertionClaimMap
  /** Where GET /v1/sso/:provider 302s when hit WITHOUT an assertion (the login
   *  button target). The IdP authenticates then redirects back with ?assertion. */
  initiateUrl?: string
  /** Server-enforced cap on (exp - iat); rejects a long-lived assertion even if
   *  the IdP mints one. Default 300s. */
  maxLifetimeSeconds: number
  /** Supabase-native SAML/OIDC domain (signInWithSSO), for kind oidc/saml. */
  domain?: string
  /** Supabase-native OAuth provider name (signInWithOAuth), for kind oidc. */
  supabaseProvider?: string
}

export interface SsoPublicInfo {
  id: string
  label: string
  kind: SsoProviderKind
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

const ClaimMapSchema = z
  .object({
    email: z.string().min(1).default("email"),
    emailVerified: z.string().min(1).default("email_verified"),
    subject: z.string().min(1).default("sub"),
  })
  // zod v4 uses a `.default()` value verbatim without re-parsing it, so an
  // ABSENT claimMap must default to the fully-populated map (not `{}`); a
  // PARTIAL claimMap still gets its missing fields filled by the inner
  // field-level defaults when the object schema parses it.
  .default({ email: "email", emailVerified: "email_verified", subject: "sub" })

const ProviderSchema = z
  .object({
    id: z.string().regex(ID_RE, "provider id must be a url-safe slug [a-z0-9_-]"),
    label: z.string().min(1),
    kind: z.enum(["assertion", "oidc", "saml"]),
    secret: z.string().min(16).optional(),
    audience: z.string().min(1).optional(),
    claimMap: ClaimMapSchema,
    initiateUrl: z.string().url().optional(),
    maxLifetimeSeconds: z.number().int().positive().max(3600).default(300),
    domain: z.string().min(1).optional(),
    supabaseProvider: z.string().min(1).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.kind === "assertion") {
      if (!p.secret)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `provider "${p.id}": assertion kind requires "secret"` })
      if (!p.audience)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `provider "${p.id}": assertion kind requires "audience"` })
    }
    if ((p.kind === "oidc" || p.kind === "saml") && !p.domain && !p.supabaseProvider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `provider "${p.id}": ${p.kind} kind requires "domain" or "supabaseProvider"`,
      })
    }
  })

export function parseSsoProviders(raw: string | undefined): SsoProviderConfig[] {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return []
  const text = trimmed.startsWith("@") ? readFileSync(trimmed.slice(1), "utf8") : trimmed

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`EXTERNAL_SSO_PROVIDERS is not valid JSON: ${(e as Error).message}`)
  }

  const arr = z.array(ProviderSchema).safeParse(json)
  if (!arr.success) {
    const msg = arr.error.issues.map((i) => i.message).join("; ")
    throw new Error(`EXTERNAL_SSO_PROVIDERS invalid: ${msg}`)
  }

  const seen = new Set<string>()
  for (const p of arr.data) {
    if (seen.has(p.id)) throw new Error(`EXTERNAL_SSO_PROVIDERS: duplicate provider id "${p.id}"`)
    seen.add(p.id)
  }
  return arr.data
}

let cache: SsoProviderConfig[] | undefined
export function getSsoProviders(): SsoProviderConfig[] {
  if (!cache) cache = parseSsoProviders(config.EXTERNAL_SSO_PROVIDERS)
  return cache
}

export function getSsoProvider(id: string): SsoProviderConfig | undefined {
  return getSsoProviders().find((p) => p.id === id)
}

export function ssoPublicInfo(p: SsoProviderConfig): SsoPublicInfo {
  return { id: p.id, label: p.label, kind: p.kind }
}

export function ssoLinkExistingEnabled(): boolean {
  const v = config.EXTERNAL_SSO_LINK_EXISTING.trim().toLowerCase()
  return v === "true" || v === "1"
}
