/**
 * The Supabase keys a self-hosted install may run in production with.
 *
 * docker-compose.community.yml ships working defaults so the quick-start needs
 * nothing configured: a JWT secret, and an anon and a service role key signed
 * with it. They are public (they are in the published compose file), and the
 * service role key bypasses row level security, so an install that reaches
 * people on them hands every account's data to anyone who reads the file.
 * `tools/generate-selfhost-keys.mjs` mints an install's own set.
 *
 * In production the install refuses to start on:
 *   - SUPABASE_JWT_SECRET equal to the shipped default;
 *   - SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY signed with the shipped
 *     secret (the two shipped keys, and any other anyone can sign with it);
 *   - on the bundled stack (SUPABASE_URL is the in-container proxy) with the
 *     secret set, a key the secret did not sign: the auth and database
 *     services would refuse every request it makes.
 *
 * Production is NODE_ENV=production (the image sets it) unless PUBLIC_URL is
 * an address on this machine (localhost, 127.0.0.0/8, ::1, *.localhost) —
 * the quick-start's own default. An unset PUBLIC_URL is production: only an
 * explicit loopback address is exempt, and the exemption is logged loudly
 * when the defaults run under it (selfhostKeysWarning). There is no other way
 * around the refusal: minting a set is one command.
 *
 * A key that is not an HS256 token is never called a default (the defaults
 * are HS256 tokens), so a managed Supabase project's own keys, JWT or not, are
 * judged only on that; they are never matched against the bundled secret.
 *
 * Pure: it reads only the environment it is given and loads nothing of the
 * server's configuration, so start.sh, the compose file's one-shot check and
 * config.ts all run this same rule.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

type Env = Readonly<Record<string, string | undefined>>

/** The JWT secret docker-compose.community.yml ships (public by definition). */
export const SELFHOST_DEFAULT_JWT_SECRET = "nodaro-community-default-jwt-secret-change-me-please"

/** Mints a matched secret + anon + service role set and appends it to .env. */
export const SELFHOST_MINT_KEYS_COMMAND = "node tools/generate-selfhost-keys.mjs >> .env"

/** Mints only a fresh secret (a managed project keeps its own keys). */
export const SELFHOST_MINT_SECRET_ONLY_COMMAND = "node tools/generate-selfhost-keys.mjs | grep '^SUPABASE_JWT_SECRET=' >> .env"

/** Restarts the compose stack with the new values. */
export const SELFHOST_RESTART_COMMAND = "docker compose -f docker-compose.community.yml up -d"

export type SelfhostKeyVariable = "SUPABASE_JWT_SECRET" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_ANON_KEY"

export interface SelfhostKeyFinding {
  readonly variable: SelfhostKeyVariable
  readonly reason: "public-default" | "not-signed-by-secret"
}

const value = (v: string | undefined): string | undefined => v?.trim() || undefined

function parsedUrl(url: string | undefined): URL | null {
  const raw = value(url)
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * The host is this machine: localhost, *.localhost, 127.0.0.0/8 or ::1.
 * Deliberately narrower than "private" (`@nodaro/shared` isLocalOrPrivateHostname):
 * a LAN address is a network other people reach.
 */
export function isLoopbackUrl(url: string | undefined): boolean {
  const parsed = parsedUrl(url)
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return false
  const host = parsed.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "[::1]") return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  return v4 !== null && Number(v4[1]) === 127 && v4.slice(2).every((o) => Number(o) <= 255)
}

/** The rule applies: NODE_ENV=production, unless PUBLIC_URL is an address on this machine. */
export function selfhostKeysEnforced(env: Env): boolean {
  return value(env.NODE_ENV) === "production" && !isLoopbackUrl(env.PUBLIC_URL)
}

/** SUPABASE_URL is the bundled stack's in-container proxy (the compose default), not a managed project. */
export function usesBundledSupabase(env: Env): boolean {
  const parsed = parsedUrl(env.SUPABASE_URL)
  return parsed !== null && isLoopbackUrl(env.SUPABASE_URL) && parsed.pathname.startsWith("/supabase")
}

interface Hs256Token {
  readonly signingInput: string
  readonly signature: Buffer
}

/** The parts of an HS256 JWT, or null for anything else (another algorithm, not a JWT). */
function hs256Token(token: string): Hs256Token | null {
  const parts = token.split(".")
  if (parts.length !== 3 || parts.some((p) => p === "")) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as { alg?: unknown }
    if (header?.alg !== "HS256") return null
  } catch {
    return null
  }
  return { signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2]!, "base64url") }
}

function signedWith(token: Hs256Token, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(token.signingInput).digest()
  return token.signature.length === expected.length && timingSafeEqual(token.signature, expected)
}

/**
 * What is wrong with the install's keys, whether or not the rule applies here
 * (the caller decides: selfhostKeysProblem refuses, selfhostKeysWarning warns).
 * Ordered secret, service role key, anon key.
 */
export function selfhostKeyFindings(env: Env): SelfhostKeyFinding[] {
  const secret = value(env.SUPABASE_JWT_SECRET)
  const ownSecret = secret !== undefined && secret !== SELFHOST_DEFAULT_JWT_SECRET ? secret : undefined
  const bundled = usesBundledSupabase(env)
  const secretFindings: SelfhostKeyFinding[] =
    secret === SELFHOST_DEFAULT_JWT_SECRET ? [{ variable: "SUPABASE_JWT_SECRET", reason: "public-default" }] : []
  const keyFindings = (["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"] as const).flatMap((variable): SelfhostKeyFinding[] => {
    const key = value(env[variable])
    if (key === undefined) return []
    const token = hs256Token(key)
    if (token && signedWith(token, SELFHOST_DEFAULT_JWT_SECRET)) return [{ variable, reason: "public-default" }]
    if (bundled && ownSecret !== undefined && !(token && signedWith(token, ownSecret))) return [{ variable, reason: "not-signed-by-secret" }]
    return []
  })
  return [...secretFindings, ...keyFindings]
}

function findingLine(f: SelfhostKeyFinding): string {
  if (f.variable === "SUPABASE_JWT_SECRET") {
    return "SUPABASE_JWT_SECRET is the public default secret shipped in docker-compose.community.yml: anyone can sign their own keys with it"
  }
  if (f.reason === "not-signed-by-secret") {
    return `${f.variable} is not signed by SUPABASE_JWT_SECRET (the key and the secret come from different runs): sign-in and every database call would be refused`
  }
  return f.variable === "SUPABASE_SERVICE_ROLE_KEY"
    ? "SUPABASE_SERVICE_ROLE_KEY is a public default key (signed with the shipped secret): it bypasses row level security"
    : "SUPABASE_ANON_KEY is a public default key (signed with the shipped secret)"
}

/** What to run, for the bundled stack (a whole new set) or a managed project (a secret only; its own keys). */
function fixLines(env: Env, findings: readonly SelfhostKeyFinding[]): string[] {
  if (usesBundledSupabase(env)) {
    return ["Mint your own set (the secret and both keys come from one run), then restart:", `  ${SELFHOST_MINT_KEYS_COMMAND}`, `  ${SELFHOST_RESTART_COMMAND}`]
  }
  const secretLines = findings.some((f) => f.variable === "SUPABASE_JWT_SECRET")
    ? ["Mint a secret of your own for the bundled auth and database services (your project's keys stay as they are):", `  ${SELFHOST_MINT_SECRET_ONLY_COMMAND}`]
    : []
  const keyLines = findings.some((f) => f.variable !== "SUPABASE_JWT_SECRET")
    ? ["Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY to your Supabase project's own keys (its API settings)."]
    : []
  return [...secretLines, ...keyLines, "Then restart:", `  ${SELFHOST_RESTART_COMMAND}`]
}

/** PUBLIC_URL as it decided "production": its origin, or that it is not set. */
function publicUrlShown(env: Env): string {
  const parsed = parsedUrl(env.PUBLIC_URL)
  if (parsed) return `PUBLIC_URL=${parsed.origin}`
  return value(env.PUBLIC_URL) ? "PUBLIC_URL is not a URL" : "PUBLIC_URL is not set"
}

/**
 * Why this install must not start, or null. Names each variable, never its
 * value, and the command that fixes it.
 */
export function selfhostKeysProblem(env: Env): string | null {
  if (!selfhostKeysEnforced(env)) return null
  const findings = selfhostKeyFindings(env)
  if (findings.length === 0) return null
  return [
    `this install runs in production (NODE_ENV=production, ${publicUrlShown(env)}) on Supabase keys it must not use:`,
    ...findings.map((f) => `  - ${findingLine(f)}`),
    ...fixLines(env, findings),
  ].join("\n")
}

/**
 * The loud line for the quick-start: production mode, an address on this
 * machine, and the public defaults. It starts (the demo keeps working), but
 * the compose file publishes its port on every network interface, so whoever
 * can reach this machine can use the defaults too. Null otherwise.
 */
export function selfhostKeysWarning(env: Env): string | null {
  if (value(env.NODE_ENV) !== "production" || selfhostKeysEnforced(env)) return null
  const defaults = selfhostKeyFindings(env).filter((f) => f.reason === "public-default")
  if (defaults.length === 0) return null
  return [
    `running on the public default Supabase keys (${defaults.map((f) => f.variable).join(", ")}), allowed only because PUBLIC_URL is an address on this machine.`,
    "Anyone who can reach this machine's port can read and change every account's data with them.",
    `Before anyone else can reach it, mint your own: ${SELFHOST_MINT_KEYS_COMMAND}`,
  ].join(" ")
}
