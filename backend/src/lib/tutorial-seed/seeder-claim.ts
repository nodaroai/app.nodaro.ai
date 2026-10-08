/**
 * Which environment may write template rows to this database (decided
 * 2026-10-08).
 *
 * On Cloud, staging and production share one Supabase project but not one
 * configuration: the preview stop rule, for one, can be on in one and off in
 * the other, and the seeder writes a different template for each state. With
 * both seeding, every deploy of one would overwrite the other's templates. So
 * the FIRST Cloud environment that seeds claims the database: one
 * `app_settings` row (key `template_seeder_claim`, value `{ url, claimedAt }`),
 * keyed by that environment's public URL (`PUBLIC_URL`). An environment whose
 * URL differs refuses to write any template row, logs one warning, and boot
 * carries on.
 *
 * A Cloud environment with `PUBLIC_URL` unset has no identity to claim with
 * (decided 2026-10-08, round 5). It reads the claim and refuses ONLY when one
 * already exists (another environment holds the database); with no claim it
 * seeds exactly as before and writes NO claim, so the first environment that
 * has a URL can still take it. It never borrows an identity from the other
 * public-URL helpers.
 *
 * A Cloud environment whose `PUBLIC_URL` is SET but is not an http(s) URL is
 * misconfigured (decided 2026-10-08, round 6): it ALWAYS refuses, claim or no
 * claim, with no database call at all, and logs one warning naming what is
 * wrong with the value (never the value itself, which may carry credentials).
 *
 * Community and business never claim: each runs against its own database, so
 * they seed exactly as before, with no `app_settings` call at all.
 *
 * The claim is the ONLY way the seeder reaches the database: the licence it
 * returns carries the client, and nothing else under `lib/tutorial-seed/`
 * imports `../supabase.js` (pinned by seeder-claim-totality.test.ts). A new
 * writer added to the seeder therefore cannot skip the claim.
 *
 * Moving the claim (a new production URL, say) is an operator step: update or
 * delete the row (see docs/deployment.md), then restart the environment that
 * should seed.
 */
import { supabase } from "../supabase.js"
import { config, isCloud } from "../config.js"

export const TEMPLATE_SEEDER_CLAIM_KEY = "template_seeder_claim"

declare const licenceBrand: unique symbol

/** Proof that this environment may write template rows, and the only handle
 *  on the database the seeder has. Minted here and nowhere else. */
export interface SeederLicence {
  readonly [licenceBrand]: true
  readonly db: typeof supabase
}

const mint = (): SeederLicence => ({ db: supabase }) as SeederLicence

/** What `PUBLIC_URL` says about this environment. `malformed` carries only a
 *  description of the problem, never the raw value. */
export type SeedingPublicUrl =
  | { kind: "unset" }
  | { kind: "malformed"; problem: string }
  | { kind: "valid"; origin: string }

/**
 * Classify `PUBLIC_URL` (read at call time) for the claim: unset (empty or
 * whitespace), malformed (set, but not an http(s) URL), or a valid origin.
 */
export function publicUrlForSeeding(publicUrl: string = config.PUBLIC_URL): SeedingPublicUrl {
  const raw = publicUrl.trim()
  if (!raw) return { kind: "unset" }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { kind: "malformed", problem: "PUBLIC_URL is set but is not a URL (expected https://host)" }
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return {
      kind: "malformed",
      problem: `PUBLIC_URL is set but its scheme is ${JSON.stringify(u.protocol)}, not http(s)`,
    }
  }
  return { kind: "valid", origin: u.origin }
}

/**
 * This environment's identity for the claim: the origin of `PUBLIC_URL`, read
 * at call time. Never a fallback: the other public-URL helpers fall back to
 * the first CORS origin (the same on staging and production) or to the
 * production host, either of which would let one environment pass as another.
 * Null when `PUBLIC_URL` is unset or not an http(s) URL.
 */
export function seederIdentity(publicUrl: string = config.PUBLIC_URL): string | null {
  const parsed = publicUrlForSeeding(publicUrl)
  return parsed.kind === "valid" ? parsed.origin : null
}

/** The URL a stored claim names, normalised like ours. Null for a value that
 *  is not a claim (hand-edited into another shape). */
function claimedUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const url = (value as { url?: unknown }).url
  return typeof url === "string" ? seederIdentity(url) : null
}

async function readClaim(): Promise<{ found: boolean; url: string | null; raw: unknown }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", TEMPLATE_SEEDER_CLAIM_KEY)
    .maybeSingle()
  if (error) throw error
  if (!data) return { found: false, url: null, raw: null }
  const raw = (data as { value?: unknown }).value
  return { found: true, url: claimedUrl(raw), raw }
}

function refuse(reason: string, remedy = "to move the claim"): null {
  console.warn(
    `[tutorial-seed] not seeding: ${reason}. No template row is written from this environment; ` +
      `see "Template seeder claim" in docs/deployment.md ${remedy}.`,
  )
  return null
}

function verdict(here: string, claim: { url: string | null; raw: unknown }): SeederLicence | null {
  if (claim.url === here) return mint()
  return refuse(
    `the database's template seeder is ${claim.url ?? JSON.stringify(claim.raw)}, and this environment is ${here}`,
  )
}

/**
 * Claim (or confirm) the database for `here`, an identity from seederIdentity.
 * Insert-if-absent: of two environments racing on an empty claim, the UNIQUE
 * key lets exactly one insert land; the other reads the winner back and
 * compares. Two replicas of one environment share a URL, so both proceed.
 */
export async function claimTemplateSeedingAs(here: string): Promise<SeederLicence | null> {
  const existing = await readClaim()
  if (existing.found) return verdict(here, existing)

  const { error } = await supabase
    .from("app_settings")
    .insert({ key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: here, claimedAt: new Date().toISOString() } })
  if (!error) {
    console.log(`[tutorial-seed] ${here} claimed this database as its template seeder`)
    return mint()
  }
  if ((error as { code?: unknown }).code !== "23505") throw error
  // Someone else inserted between our read and our write.
  const winner = await readClaim()
  if (!winner.found) throw new Error("template seeder claim vanished while it was being taken")
  return verdict(here, winner)
}

/**
 * The gate for a Cloud environment with no identity: seed, unclaimed, while
 * nobody holds the claim; refuse once someone does. Read-only: it never
 * writes the claim, since a claim it wrote could name no environment.
 */
export async function seedWithoutIdentity(): Promise<SeederLicence | null> {
  const existing = await readClaim()
  if (!existing.found) return mint()
  return refuse(
    `the database's template seeder is ${existing.url ?? JSON.stringify(existing.raw)}, and this environment has no PUBLIC_URL to compare with it`,
  )
}

/**
 * The seeder's gate. Off Cloud: a licence, with no database call. On Cloud
 * with a valid `PUBLIC_URL`: a licence only for the environment that holds (or
 * just took) the claim. On Cloud with it unset: a licence only while no claim
 * exists, and no claim is written. On Cloud with it set but malformed: never a
 * licence, and no database call. Otherwise null, after one warning. A read or
 * write error throws, so the seeder's own handling applies (a transport error
 * retries the run).
 */
export async function claimTemplateSeeding(): Promise<SeederLicence | null> {
  if (!isCloud()) return mint()
  const url = publicUrlForSeeding()
  switch (url.kind) {
    case "malformed":
      return refuse(url.problem, "and fix PUBLIC_URL")
    case "unset":
      return seedWithoutIdentity()
    case "valid":
      return claimTemplateSeedingAs(url.origin)
  }
}
