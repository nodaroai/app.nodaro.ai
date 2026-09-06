/**
 * The BILLING ACCOUNT's own routes (spec §8.2) — `/v1/deployment-billing/*`.
 *
 * On a deployment-payer instance there are three principals, not two: the
 * users, the customer's admins, and the ONE account that holds the credits
 * everybody spends. This file is that third principal's surface, and it is the
 * only place in the product where Nodaro's real balance is rendered, where an
 * allocation is minted, and where a card is charged on the customer's behalf.
 *
 * WHY THESE ROUTES ARE NOT ADMIN ROUTES. On this deployment the CUSTOMER runs
 * the identity provider, so the customer mints the identities `profiles.role`
 * hangs off. An authorization check keyed on that column is downstream of the
 * party it would have to constrain. `requireDeploymentPayer` therefore checks
 * IDENTITY — `req.userId === deploymentPayerId()`, a uuid resolved at boot from
 * operator-owned surface-profile config and unwritable from inside the product
 * — plus a first-party browser session, and every write verb ALSO calls
 * `rejectProgrammaticAuth`. The redundancy is deliberate: decision (6) puts a
 * payer-owned relay credential on developers' laptops, and a leaked one must
 * be able to spend the pool but never to allocate or to purchase.
 *
 * MAINLINE IS BYTE-IDENTICAL (R2). `app.ts` registers this plugin only under
 * `hasCredits() && deploymentPayerActive()`, so with no `billing.payerAccount`
 * these paths do not exist and nothing in this file is ever reached. The
 * guard's own null-payer branch answers 404 rather than 403 for the same
 * reason — a route that exists only under a payer must look ABSENT where there
 * is none.
 *
 * UNITS (R3). Everything the browser sends and every PER-USER figure rendered
 * back is display units; everything the database sees is raw Nodaro credits. The
 * conversion happens at this boundary and nowhere else: `creditsFromUnits` on
 * the way in — which REFUSES anything that is not a whole number of credits at
 * `billing.unitRate` — and `toUnits` on the way out. A unit that reached
 * `grant_deployment_allowance` would inflate an allocation 2000-fold, and
 * neither the ledger nor the RPC could notice.
 *
 * THE POOL IS THE EXCEPTION, deliberately: `/overview` renders the payer's
 * balance and this period's burn in RAW Nodaro credits, labelled as Nodaro's.
 * That figure is Nodaro's money, not an allocation denominated in the
 * customer's unit, and converting it would invent an exchange rate for
 * something that is not being exchanged.
 */
import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { MODEL_CATALOG } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { CreditsService, PriceNotConfiguredError } from "../billing/credits.js"
import { getStripe } from "../billing/stripe-client.js"
import { ensureStripeCustomer } from "../billing/provision-credits.js"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "../billing/load-rate.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import {
  countLiveBillingKeys,
  listBillingKeys,
  MAX_LIVE_BILLING_KEYS,
  mintBillingKey,
  normalizeCidr,
  revokeBillingKey,
  type BillingKeyRow,
} from "../../lib/billing-key-resolver.js"
import { requireDeploymentPayer, PAYER_JWT_ONLY_MSG } from "../middleware/require-deployment-payer.js"
import { allowanceEnforcementActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { runtimeSurfaceProfile } from "../../lib/surface-profile.js"
import { isModelDenied } from "../../lib/surface-deny.js"
import { toUnits } from "../../lib/billing-display-unit.js"
import { invalidateBalanceCache } from "./credits.js"
import {
  allowanceLedgerFor,
  allowanceLedgerOne,
  defaultAllowanceCredits,
  grantAllowance,
  grantsFor,
  provisionedUserCount,
  resolveUserRef,
  setAllowance,
  setDefaultAllowance,
  ssoSubjectsFor,
  writePendingAllowance,
  type AllowanceLedgerRow,
  type AllowanceWriteErrorCode,
} from "../billing/deployment-allowance-service.js"
import type { UserAllowance, UserRef } from "../../types/deployment-allowance.js"

// ---------------------------------------------------------------------------
// The unit seam
// ---------------------------------------------------------------------------

interface DisplayUnit {
  readonly label: string
  readonly rate: number
  readonly decimals: number
}

/** The deployment's display unit, or null when the profile carries none.
 *  Null is a REFUSAL condition for anything that takes `units`: treating a unit
 *  as a credit on a deployment whose unit trio went missing would be a silent
 *  2000-fold over-allocation, and the reverse would be the same error the other
 *  way. */
function configuredUnit(): DisplayUnit | null {
  const b = runtimeSurfaceProfile().billing
  if (typeof b.unitLabel !== "string") return null
  if (typeof b.unitRate !== "number" || !Number.isFinite(b.unitRate) || b.unitRate <= 0) return null
  return { label: b.unitLabel, rate: b.unitRate, decimals: b.unitDecimals ?? 0 }
}

/** Raw credits → display units, through the ONE conversion. `null` survives as
 *  null all the way to the screen's em dash: 0 means "exhausted" and must never
 *  be manufactured for "not known". */
function inUnits(credits: number | null | undefined, u: DisplayUnit | null): number | null {
  return u === null ? null : toUnits(credits, u.rate, u.decimals)
}

type UnitInput =
  | { ok: true; credits: number }
  | { ok: false; code: "unit_not_configured" | "unit_not_whole_credits" | "invalid_units"; message: string }

/**
 * Display units → raw credits, or a refusal.
 *
 * The whole-credits rule is the load-bearing half. The ledger is an INTEGER
 * column of Nodaro credits; a unit figure that does not divide by `unitRate`
 * has no credit representation, and rounding it would mean the payer allocated
 * a number nobody can reconcile against the sum of the grant rows. So it is a
 * 400 that names the rate, and the payer learns the granularity from the
 * product rather than from a support ticket.
 *
 * `allowZero` is the one thing an ABSOLUTE target needs that an additive grant
 * must never have. "The plan is now 0" is what a cancelled subscription means
 * and it has to be expressible; "add 0 credits" is a call that moves nothing
 * and is a bug in the caller, so it keeps its refusal. Only the `set`/`renew`
 * verb passes it.
 */
function creditsFromUnits(raw: unknown, opts: { allowNegative: boolean; allowZero?: boolean }): UnitInput {
  const u = configuredUnit()
  if (u === null) {
    return {
      ok: false,
      code: "unit_not_configured",
      message: "This deployment has no display unit configured, so an allowance cannot be expressed in units.",
    }
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, code: "invalid_units", message: "units must be a whole number." }
  }
  if ((raw === 0 && opts.allowZero !== true) || (raw < 0 && !opts.allowNegative)) {
    return {
      ok: false,
      code: "invalid_units",
      message: opts.allowNegative ? "units must not be zero." : "units must be a positive whole number.",
    }
  }
  if (raw % u.rate !== 0) {
    return {
      ok: false,
      code: "unit_not_whole_credits",
      message:
        `units must be a whole number of Nodaro credits: a multiple of ${u.rate} ` +
        `${u.label} (1 credit = ${u.rate} ${u.label}).`,
    }
  }
  return { ok: true, credits: raw / u.rate }
}

// ---------------------------------------------------------------------------
// Shared route plumbing
// ---------------------------------------------------------------------------

/** Origin for a redirect URL. `billing.ts` keeps its own copy private and this
 *  file must not reach into it. */
function getOrigin(req: FastifyRequest): string {
  const origin = req.headers.origin
  const referer = req.headers.referer
  if (typeof origin === "string" && origin) return origin
  if (typeof referer === "string" && referer) {
    try {
      return new URL(referer).origin
    } catch {
      /* fall through */
    }
  }
  return ""
}

function paging(query: Record<string, string | undefined>, max = 200, fallback = 50) {
  const limit = Math.min(max, Math.max(1, parseInt(query.limit ?? String(fallback), 10) || fallback))
  const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0)
  return { limit, offset }
}

/** The grant note's cap. The column is bare `text` (382:124) and the textarea
 *  has no counterpart, so this route is the only enforcement point. */
const NOTE_MAX_CHARS = 500

function err(code: string, message: string, detail?: string) {
  return { error: detail === undefined ? { code, message } : { code, message, detail } }
}

/** Which HTTP status each database-side refusal means. A misconfiguration is a
 *  FAULT (500), not a business refusal (D9): a 4xx would tell the payer to
 *  change what they typed when the deployment is what is wrong. */
const WRITE_STATUS: Record<AllowanceWriteErrorCode, number> = {
  allowance_unconfigured: 500,
  allowance_actor_not_payer: 403,
  allowance_kind_invalid: 400,
  allowance_zero_grant: 400,
  allowance_below_committed: 409,
  // 387's two verbs. No route in THIS file can raise either yet — the page
  // grants and sets a default, and neither RPC takes a mode or a target — but
  // the map is total over the union on purpose, so the code that adds those
  // routes cannot ship a refusal that falls through to an unmapped 500.
  allowance_mode_invalid: 400,
  allowance_target_invalid: 400,
  allowance_write_failed: 500,
}

/** Fixed wire text per refusal. The database's own message carries interpolated
 *  figures and travels as `detail` — safe here, and ONLY here, because every
 *  route in this file is reachable by the billing account alone. */
const WRITE_MESSAGE: Record<AllowanceWriteErrorCode, string> = {
  allowance_unconfigured: "This deployment's billing settings are not initialised. Nothing was changed.",
  allowance_actor_not_payer: "Only the deployment's billing account may change an allowance.",
  allowance_kind_invalid: "Unsupported grant kind.",
  allowance_zero_grant: "A grant must move a non-zero number of credits.",
  allowance_below_committed:
    "That correction would push the allowance below what this user has already reserved or spent. " +
    "Lower it by less, or wait for the running jobs to finish.",
  allowance_mode_invalid: "Unsupported allowance mode.",
  allowance_target_invalid: "An allowance target must be zero or a positive whole number.",
  allowance_write_failed: "The allowance could not be updated. Nothing was changed.",
}

/** The per-user figures, converted at the render boundary. `null` when the
 *  ledger read was unavailable — an em dash on the page, never a zero. */
function ledgerInUnits(row: AllowanceLedgerRow | null | undefined, u: DisplayUnit | null) {
  return {
    granted: inUnits(row?.granted ?? null, u),
    remaining: inUnits(row?.remaining ?? null, u),
    spent: inUnits(row?.spent ?? null, u),
    provisioned: row?.provisioned ?? false,
  }
}

/** Strict allowlist on a search term — LETTERS AND DIGITS IN ANY SCRIPT, spaces
 *  and the email characters. PostgREST's `or()` takes a filter EXPRESSION, so an
 *  unescaped term is a filter-injection vector, not merely a bad query.
 *
 *  Unicode-aware (`\p{L}\p{N}` with the `u` flag) rather than `a-zA-Z0-9`,
 *  because the display names on a Hebrew-default deployment are Hebrew: the
 *  ASCII allowlist stripped the whole block, and a term that sanitised to
 *  nothing (or to a lone space) either reported "no search" or matched
 *  everything — so the payer typed a name, got the UNFILTERED list back, and had
 *  no way to tell the filter had done nothing.
 *
 *  The safety posture is unchanged: this widens the allowlist by letters and
 *  digits only. Every character with meaning inside an `or()` expression —
 *  `%`, `,`, `(`, `)`, `*`, `:` — is still removed, in every script. `\p{M}`
 *  keeps combining marks (Hebrew niqqud, Arabic harakat, accents that arrive
 *  decomposed) attached to the letter they belong to instead of amputating them.
 *
 *  A term that is only separators (a lone space) is treated as no search at
 *  all: it would otherwise become `ilike.% %`, which matches nearly everyone
 *  and reads exactly like a filter that is broken. */
function sanitizeSearch(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const clean = trimmed.replace(/[^\p{L}\p{N}\p{M}\s@.\-]/gu, "").trim()
  return clean.length > 0 ? clean : null
}

/** This calendar month, UTC — the same period the `/usage` provider reports, so
 *  the payer's burn and a user's consumption cannot disagree about when "this
 *  period" started. */
function periodStart(): Date {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** The refusal for the verbs that stay BROWSER-SESSION-ONLY even though the
 *  guard above them now accepts a billing integration key too. Its own code, so
 *  a support ticket that quotes it names the gate in one line — and so the log
 *  line the guard writes is not the only trace. */
const PAYER_SESSION_ONLY_MSG =
  "This operation is available only from the billing account's signed-in browser session, " +
  "not from a billing integration key."

/**
 * Two verbs are excluded from the widened guard, in the route rather than in
 * the guard, so the exception is visible at the thing it protects:
 *
 *   * `POST /checkout` — the one verb that turns a leaked credential into a
 *     charge on a real card. It stays browser-only forever.
 *   * `POST /integration-keys` — a key must not be able to mint a key, exactly
 *     as a personal token cannot mint a personal token (`api-tokens.ts`).
 *     Otherwise one leaked credential silently becomes a permanent supply of
 *     them, and revoking the leaked one changes nothing.
 *
 * Returns true (and sends a 403) when the caller is anything but a browser
 * session — the handler must `return` immediately.
 */
function refuseWithoutPayerSession(req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }): boolean {
  if (req.authKind !== "jwt") {
    reply.status(403).send(err("payer_session_required", PAYER_SESSION_ONLY_MSG))
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Naming a user: the three forms an integration may use
// ---------------------------------------------------------------------------
//
// An integration in the customer's back office knows the identity its own
// identity provider asserts — a subject, and an email address — and has never
// seen the studio's uuid until a response hands it one. So a user is named
// three ways, resolved through the service (which owns the trusted
// `app_metadata` copy of the subject), and the answer echoes all three so the
// caller can store the uuid after the first call and stop looking it up.

/** Canonical uuid. Deliberately strict: a near-miss must be
 *  `invalid_user_ref`, not a lookup that finds nobody and is then
 *  indistinguishable from a person who has simply not signed in yet — which
 *  would silently be stored as a pending quota for an identity nobody holds. */
const USER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The narrowest thing that can be called an address. `profiles.email` is the
 *  authority; this only has to reject a reference that is plainly not an
 *  address, so `email:nope` answers 400 rather than a 404 the integration
 *  would read as "not signed in yet" and act on. */
const REF_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * `<uuid>` | `sso:<subject>` | `email:<address>` → the ref the service
 * resolves, or null when it is none of the three.
 *
 * The prefixes are tested BEFORE the uuid shape, so a subject that happens to
 * look like a uuid still resolves as a subject: the customer's IdP owns that
 * namespace and the studio's uuid space is a different one.
 */
function parseUserRef(raw: string | undefined): UserRef | null {
  const s = (raw ?? "").trim()
  if (!s) return null
  if (s.startsWith("sso:")) {
    const subject = s.slice(4).trim()
    return subject ? { ssoSubject: subject } : null
  }
  if (s.startsWith("email:")) {
    const email = s.slice(6).trim()
    return email && REF_EMAIL_RE.test(email) ? { email } : null
  }
  return USER_UUID_RE.test(s) ? { id: s } : null
}

/** D13, in one string: the billing account holds the pool and has no quota
 *  against it. Shared by every verb that takes a user reference so the three
 *  cannot drift apart. */
const PAYER_NO_ALLOWANCE_MSG =
  "The billing account holds the deployment's credits and has no allowance. Buy credits instead."

type RefOutcome =
  | { kind: "user"; userId: string; ref: UserRef }
  | { kind: "absent"; ref: UserRef }
  | { kind: "refused" }

/**
 * Parse a reference, resolve it, and SEND the refusal when there is one — the
 * caller checks `kind` and returns immediately on `refused`.
 *
 * THE PAYER IS NEVER A VALID USER REFERENCE, and that check is made after
 * resolution rather than only on the uuid form: `sso:` and `email:` can both
 * name the billing account, and a quota against the account that holds the
 * pool is a concept that does not exist.
 *
 * `absent` is NOT a refusal — it is the answer each caller decides about: the
 * allowance verb stores an intent, `/users/resolve` answers 404, `/usage`
 * answers an empty page. An ambiguous match IS a refusal everywhere, because
 * acting on half of a duplicated address moves a paid quota to the wrong
 * person.
 */
async function resolveRef(raw: string | undefined, reply: FastifyReply): Promise<RefOutcome> {
  const ref = parseUserRef(raw)
  if (!ref) {
    reply
      .status(400)
      .send(
        err(
          "invalid_user_ref",
          "Name the user by studio id, by sso:<subject> or by email:<address>.",
        ),
      )
    return { kind: "refused" }
  }
  const resolved = await resolveUserRef(ref)
  if (resolved.kind === "ambiguous") {
    return refuseAmbiguous(reply)
  }
  if (resolved.kind === "absent") return { kind: "absent", ref }
  if (resolved.userId === deploymentPayerId()) {
    reply.status(400).send(err("payer_has_no_allowance", PAYER_NO_ALLOWANCE_MSG))
    return { kind: "refused" }
  }
  return { kind: "user", userId: resolved.userId, ref }
}

function refuseAmbiguous(reply: FastifyReply): RefOutcome {
  reply
    .status(409)
    .send(
      err(
        "user_ambiguous",
        "More than one account answers to that email address. Name the user by their SSO subject instead.",
      ),
    )
  return { kind: "refused" }
}

/** One figure in BOTH denominations. An integration is a render boundary, so
 *  it gets the display unit its customer's invoice speaks and the raw credit
 *  the ledger stores — never one alone, because deriving the other on their
 *  side means re-implementing `unitRate` in a second codebase. `null` survives
 *  as null on both halves (§5.2 rule 1): an unavailable figure is never a 0. */
function pair(credits: number | null | undefined, u: DisplayUnit | null) {
  return { units: inUnits(credits ?? null, u), credits: credits ?? null }
}

/** The allowance block every integration verb answers with. `resetAt` is null
 *  — not absent — on the wire: an integration branches on a key it can always
 *  read, and "this allowance has never been renewed" is a value, not a gap. */
function allowancePairs(row: UserAllowance | null, u: DisplayUnit | null) {
  return {
    granted: pair(row?.granted, u),
    remaining: pair(row?.remaining, u),
    spent: pair(row?.spent, u),
    resetAt: row?.resetAt ?? null,
  }
}

type NoteInput = { ok: true; note: string | null } | { ok: false; code: string; message: string }

/** The note's own validation, with its own code and its own field named — the
 *  lesson at `POST /grant`: judging `note` inside the same object as `units`
 *  answered `invalid_units` for an over-long note and named a field that was
 *  fine. Fail-closed and before any RPC, so nothing is written and the retry
 *  is safe. */
function readNote(raw: unknown): NoteInput {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { ok: false, code: "invalid_note", message: "note must be text." }
  }
  if (typeof raw === "string" && raw.length > NOTE_MAX_CHARS) {
    return {
      ok: false,
      code: "note_too_long",
      message: `The note is too long — keep it to ${NOTE_MAX_CHARS} characters or fewer.`,
    }
  }
  return { ok: true, note: typeof raw === "string" ? raw : null }
}

/**
 * How recently a `renew` must NOT have happened for another one to be allowed
 * without `force`.
 *
 * This rule is in the route because it is not in the database: the RPC will
 * renew twice a minute apart and zero a real period's `spent` the second time.
 * A back office retries, and a webhook arrives twice — so the default answer
 * to "renew again, an hour later" has to be a refusal, and `force: true` is
 * how a genuine second period inside one day is expressed.
 */
const RENEWAL_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// The pool, read once and shared
// ---------------------------------------------------------------------------

/**
 * The payer's balance and this period's burn — the two figures `/overview` and
 * `/balance` both answer with, in ONE place so a page and an integration can
 * never disagree about the money.
 *
 * RAW NODARO CREDITS throughout, deliberately: this is the pool the customer
 * bought from Nodaro, not an allocation denominated in the customer's own
 * unit, and converting it would invent an exchange rate for something that is
 * not being exchanged.
 *
 * `null` on any figure means UNAVAILABLE and must stay null all the way out.
 * A balance that could not be read is not a balance of zero, and the
 * difference is the one that decides whether a low-balance alarm is real.
 */
async function readPool(payerId: string) {
  const since = periodStart()
  // Client-side aggregation, capped — the `/usage` provider's posture. At the
  // cap the figure under-reports and says so, rather than pretending.
  const BURN_CAP = 5000
  const [balance, burnRows] = await Promise.all([
    CreditsService.getBalance(payerId).catch((e: unknown) => {
      console.error("[deployment-billing] payer balance read failed:", (e as Error).message)
      return null
    }),
    supabase
      .from("usage_logs")
      .select("credits_used, status")
      .eq("user_id", payerId)
      .in("status", ["reserved", "committed"])
      .gte("created_at", since.toISOString())
      .limit(BURN_CAP),
  ])

  const rows = burnRows.error ? [] : ((burnRows.data ?? []) as ReadonlyArray<{ credits_used: number | null }>)
  if (burnRows.error) console.error("[deployment-billing] burn read failed:", burnRows.error.message)
  return {
    balance,
    burn: {
      periodStart: since.toISOString(),
      credits: burnRows.error ? null : rows.reduce((sum, r) => sum + (r.credits_used ?? 0), 0),
      generations: burnRows.error ? null : rows.length,
      capped: rows.length === BURN_CAP,
    },
  }
}

/** The pool balance, in RAW credits, below which `lowBalance` is true — or
 *  null when the payer has not set one.
 *
 *  A read that fails answers null rather than throwing: a threshold is a
 *  convenience on top of a balance, and losing it must not take the balance
 *  down with it. Null is also the honest value for a database that has not
 *  reached the migration yet, which is the same answer as "not set". */
async function lowBalanceThreshold(): Promise<number | null> {
  const { data, error } = await supabase
    .from("deployment_payer_settings")
    .select("low_balance_threshold_credits")
    .eq("id", true)
    .maybeSingle()
  if (error) {
    console.error("[deployment-billing] low-balance threshold read failed:", error.message)
    return null
  }
  const raw = (data as { low_balance_threshold_credits?: number | null } | null)?.low_balance_threshold_credits
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

// ---------------------------------------------------------------------------
// The usage page: a keyset cursor that cannot be injected into a filter
// ---------------------------------------------------------------------------

/**
 * The characters a Postgres `timestamptz` can print, and NOT ONE MORE.
 *
 * This is the whole injection defence: the cursor's timestamp is interpolated
 * into a PostgREST `or()` FILTER EXPRESSION, where a quote, a comma or a
 * parenthesis is syntax rather than data. A value that matches this pattern
 * cannot carry any of the three, so the interpolation below is safe by
 * construction rather than by escaping — and escaping is what would have to be
 * audited every time PostgREST's grammar moves.
 */
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/

/** The boundary row, VERBATIM. `created_at` travels as the exact string the
 *  database printed — microseconds included — because rounding it through a
 *  `Date` loses the last three digits, the `created_at = c` leg of the keyset
 *  then never matches, and the boundary row is silently skipped or served
 *  twice. Base64url only so a caller is not tempted to construct one. */
function encodeUsageCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url")
}

function decodeUsageCursor(raw: string): { createdAt: string; id: string } | null {
  const decoded = Buffer.from(raw, "base64url").toString("utf8")
  const sep = decoded.lastIndexOf("|")
  if (sep <= 0) return null
  const createdAt = decoded.slice(0, sep)
  const id = decoded.slice(sep + 1)
  if (!CURSOR_TS_RE.test(createdAt) || !USER_UUID_RE.test(id)) return null
  return { createdAt, id }
}

/** An ISO instant, or `"invalid"` — never a silent fallback. A window the
 *  caller did not ask for is worse than a refusal: they would reconcile a
 *  month against a different month and never learn why the totals disagree. */
function readInstant(raw: string | undefined): string | null | "invalid" {
  if (raw === undefined || raw.trim() === "") return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? new Date(t).toISOString() : "invalid"
}

// ---------------------------------------------------------------------------

export async function deploymentBillingRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /overview — the pool, the burn, the default, the counts
  // -------------------------------------------------------------------------
  app.get("/v1/deployment-billing/overview", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const u = configuredUnit()

    const [pool, userCount, provisionedCount, defaultCredits] = await Promise.all([
      // The pool and the burn, through the one helper `GET /balance` also
      // uses — so the page and the integration cannot disagree about the money.
      readPool(payerId),
      supabase.from("profiles").select("id", { count: "exact", head: true }).neq("id", payerId),
      // Through the service, never a direct read: the allowance tables are
      // named in exactly one file so the D7 no-row rule cannot be forgotten in
      // a second place.
      provisionedUserCount(),
      defaultAllowanceCredits(),
    ])
    const balance = pool.balance

    return reply.send({
      data: {
        // RAW Nodaro credits, and labelled as such by whatever renders it —
        // this is the pool, not an allocation in the customer's unit.
        payer: {
          balanceCredits: balance?.total ?? null,
          subscriptionCredits: balance?.subscription ?? null,
          topupCredits: balance?.topup ?? null,
          tier: balance?.effectiveTier ?? balance?.tier ?? null,
          periodEnd: balance?.periodEnd ?? null,
        },
        burn: pool.burn,
        defaultAllowance: { credits: defaultCredits, units: inUnits(defaultCredits, u) },
        users: { total: userCount.count ?? null, provisioned: provisionedCount },
        unit: u,
        // Nothing refuses a generation until the overlay flips this (step 8).
        // The page says so, so the payer is not surprised in either direction.
        allowancesEnforced: allowanceEnforcementActive(),
        // R4: read the config, never getStripe(), which THROWS when unset.
        stripeConfigured: Boolean(config.STRIPE_SECRET_KEY),
      },
    })
  })

  // -------------------------------------------------------------------------
  // GET /transactions — the payer's purchases and its credit ledger
  // -------------------------------------------------------------------------
  app.get("/v1/deployment-billing/transactions", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const { limit, offset } = paging(req.query as Record<string, string | undefined>)

    // `.is("org_id", null)` mirrors /v1/billing/transactions: org pack claims
    // carry the OWNER's user_id by design (351) and are not this account's
    // history. 42703 = the column has not reached this database yet, and there
    // no org rows can exist, so the unfiltered query is the same answer.
    const purchaseColumns = "id, stripe_transaction_id, type, amount_usd, credits_granted, tier, created_at, receipt_url"
    let purchases = await supabase
      .from("transactions")
      .select(purchaseColumns)
      .eq("user_id", payerId)
      .is("org_id", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (purchases.error?.code === "42703") {
      purchases = await supabase
        .from("transactions")
        .select(purchaseColumns)
        .eq("user_id", payerId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
    }

    const ledgerColumns = "id, amount, credit_type, source, description, balance_after, created_at"
    let ledger = await supabase
      .from("credit_transactions")
      .select(ledgerColumns)
      .eq("user_id", payerId)
      .is("org_id", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (ledger.error?.code === "42703") {
      ledger = await supabase
        .from("credit_transactions")
        .select(ledgerColumns)
        .eq("user_id", payerId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
    }

    if (purchases.error || ledger.error) {
      console.error("[deployment-billing] transactions read failed:", purchases.error?.message ?? ledger.error?.message)
      return reply.status(500).send(err("read_failed", "Could not read this account's transactions."))
    }

    // Raw Nodaro credits throughout — this is the pool's own history.
    return reply.send({ data: { purchases: purchases.data ?? [], ledger: ledger.data ?? [], limit, offset } })
  })

  // -------------------------------------------------------------------------
  // GET /users — the per-user allowance table, in display units
  // -------------------------------------------------------------------------
  app.get("/v1/deployment-billing/users", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const query = req.query as Record<string, string | undefined>
    const { limit, offset } = paging(query)
    const search = sanitizeSearch(query.search)
    const u = configuredUnit()

    // `full_name`, NOT `display_name`: `profiles` HAS NO `display_name` COLUMN
    // (see frontend/src/types/database.types.ts and routes/me.ts:33 — "the
    // human-readable name lives in `full_name`"). Naming it here made PostgREST
    // answer `column "display_name" does not exist`, which this route turned
    // into a 500 `read_failed` — the user table never rendered at all — and put
    // the same non-column on the only searchable side of the filter, so the
    // name the payer is reading off the screen was not searchable either.
    let q = supabase
      .from("profiles")
      .select("id, email, full_name, created_at", { count: "exact" })
      // The payer holds the pool, not an allowance (D13). Dropped at the QUERY,
      // so it is not in the count either.
      .neq("id", payerId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)

    const { data, count, error } = await q
    if (error) {
      console.error("[deployment-billing] user list failed:", error.message)
      return reply.status(500).send(err("read_failed", "Could not read the user list."))
    }

    const rows = (data ?? []) as ReadonlyArray<{
      id: string
      email: string | null
      full_name: string | null
      created_at: string
    }>
    // ONE batch read for the page, and never a direct query against the
    // allowance table: the D7 no-row rule lives in the service, and a user who
    // has never generated must show the DEFAULT here — that is what they will
    // actually get at their first Generate.
    const ids = rows.map((r) => r.id)
    const [ledger, subjects] = await Promise.all([
      allowanceLedgerFor(ids),
      // ONE subject lookup for the whole page, never one per row. An id with
      // no subject is simply absent from the map and renders `null`: "not
      // federated" is a different fact from "the read failed", and the batch
      // answers an empty map rather than null, so losing the decoration cannot
      // lose the list.
      ssoSubjectsFor(ids),
    ])

    return reply.send({
      data: rows.map((r) => {
        const row = ledger?.get(r.id) ?? null
        return {
          ...r,
          ...ledgerInUnits(row, u),
          // The two fields an integration reads off this table: the identity
          // its own IdP asserts, and when this quota's period began — null
          // until something has renewed it, which is exactly what tells a
          // renderer to say "total" rather than "this period".
          ssoSubject: subjects.get(r.id) ?? null,
          resetAt: row?.resetAt ?? null,
        }
      }),
      total: count ?? 0,
      limit,
      offset,
      unit: u,
    })
  })

  // -------------------------------------------------------------------------
  // GET /users/resolve — the lookup an integration does once per customer
  // -------------------------------------------------------------------------
  //
  // Registered BEFORE `/users/:id/grants` reads in the file, though the router
  // does not care: a static segment always beats a parameter at the same
  // position, so `resolve` can never be mistaken for a user id.
  app.get("/v1/deployment-billing/users/resolve", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const query = req.query as Record<string, string | undefined>
    const subject = query.sso_subject?.trim() || null
    const email = query.email?.trim() || null

    // EXACTLY ONE. Both is a question with two answers that may disagree, and
    // silently preferring one would make the caller believe it had confirmed
    // an identity it had not; neither is not a lookup at all.
    if ((subject === null) === (email === null)) {
      return reply
        .status(400)
        .send(err("invalid_user_ref", "Name the user with exactly one of sso_subject or email."))
    }

    const outcome = await resolveRef(subject !== null ? `sso:${subject}` : `email:${email}`, reply)
    if (outcome.kind === "refused") return
    if (outcome.kind === "absent") {
      // 404, never a pending write: this route is a question, not a verb. The
      // caller that wants the quota stored calls the allowance verb, which
      // answers 202.
      return reply
        .status(404)
        .send(err("user_not_found", "No account on this deployment answers to that identity."))
    }

    const userId = outcome.userId
    const u = configuredUnit()
    const [row, subjects, profile] = await Promise.all([
      allowanceLedgerOne(userId),
      ssoSubjectsFor([userId]),
      supabase.from("profiles").select("id, email").eq("id", userId).maybeSingle(),
    ])

    // All three identities on every answer, so the caller stores the uuid once
    // and never resolves this person again.
    return reply.send({
      data: {
        id: userId,
        email: (profile.data as { email?: string | null } | null)?.email ?? null,
        ssoSubject: subjects.get(userId) ?? null,
        // False means "no row of their own": the figures beside it are the
        // deployment DEFAULT, which is what this person would actually get.
        provisioned: row?.provisioned ?? false,
        allowance: allowancePairs(row, u),
      },
    })
  })

  // -------------------------------------------------------------------------
  // GET /users/:id/grants — one user's grant history
  // -------------------------------------------------------------------------
  app.get("/v1/deployment-billing/users/:id/grants", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { limit, offset } = paging(req.query as Record<string, string | undefined>)
    const u = configuredUnit()

    const [row, grants] = await Promise.all([allowanceLedgerOne(id), grantsFor(id, { limit, offset })])
    if (grants === null) {
      return reply.status(500).send(err("read_failed", "Could not read this user's grant history."))
    }

    return reply.send({
      data: {
        user: { id, ...ledgerInUnits(row, u) },
        // `kind` travels so the page can LABEL an 'overrun' row: those are
        // audit-only and are excluded from `granted` (invariant 4), so a
        // history that renders them as ordinary lines will not add up.
        grants: grants.map((g) => ({
          id: g.id,
          units: inUnits(g.credits, u),
          kind: g.kind,
          note: g.note,
          createdAt: g.createdAt,
        })),
        limit,
        offset,
        unit: u,
      },
    })
  })

  // -------------------------------------------------------------------------
  // PUT /default-allowance — what a user who has not generated yet will get
  // -------------------------------------------------------------------------
  app.put("/v1/deployment-billing/default-allowance", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    // A credential that may allocate may also set what an unallocated user
    // gets. `allowBillingKey` is opt-IN, one verb at a time: every other
    // caller of this helper in the codebase keeps refusing the key by default,
    // which is the second defence behind the auth hook's path allow-list.
    //
    // NO `credential_id` HERE, unlike the two verbs below: the default lives
    // on the settings singleton, which has no audit row and no credential
    // column to stamp. A default changed through a key is therefore
    // indistinguishable from one changed on the page.
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG, { allowBillingKey: true })) return
    const actorId = req.userId
    if (!actorId) return reply.status(401).send(err("unauthorized", "Authentication required"))

    const parsed = z.object({ units: z.unknown() }).safeParse(req.body)
    const input = creditsFromUnits(parsed.success ? parsed.data.units : undefined, { allowNegative: false })
    if (!input.ok) return reply.status(400).send(err(input.code, input.message))

    const result = await setDefaultAllowance(input.credits, actorId)
    if (!result.ok) {
      return reply.status(WRITE_STATUS[result.code]).send(err(result.code, WRITE_MESSAGE[result.code], result.message))
    }

    // D7, and the sentence the page must carry: this is the figure a user who
    // has NOT generated yet will be provisioned with. It does not retro-apply,
    // and it moves no existing row.
    return reply.send({ data: { credits: input.credits, units: inUnits(input.credits, configuredUnit()) } })
  })

  // -------------------------------------------------------------------------
  // POST /users/:id/grant — a top-up (or a correction) for one user
  // -------------------------------------------------------------------------
  app.post("/v1/deployment-billing/users/:id/grant", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    // Opted in, exactly as `PUT /default-allowance` above and the absolute
    // verb below. This one DOES stamp the credential: it writes a grant row,
    // and a grant row is where "via <key name>" comes from.
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG, { allowBillingKey: true })) return
    const actorId = req.userId
    if (!actorId) return reply.status(401).send(err("unauthorized", "Authentication required"))
    const { id } = req.params as { id: string }

    if (id === deploymentPayerId()) {
      // D13: the payer holds the real credits. An allowance for it would be a
      // quota against its own pool — a concept that does not exist — and a row
      // for it would make its own runs refusable at the flip.
      return reply.status(400).send(err("payer_has_no_allowance", PAYER_NO_ALLOWANCE_MSG))
    }

    // BOTH FIELDS ARE `unknown` HERE, DELIBERATELY. `note: z.string().max(500)`
    // fails the WHOLE object on an over-long note, `parsed.success` goes false,
    // and the line below then reads `units` as `undefined` — so a valid amount
    // plus a 501-character note was answered `invalid_units` / "Enter a whole
    // number", naming a field that was fine and giving the payer no way to
    // discover the real cause (retyping the amount fails identically). Each
    // field is now judged on its own, units first.
    // `.optional()` is REQUIRED on the note, not decoration: under zod 4 a bare
    // `z.unknown()` key is NON-optional (`expected nonoptional, received
    // undefined`), so omitting it would fail the whole object — reintroducing
    // the very coupling this change removes, for every grant with no note.
    const parsed = z.object({ units: z.unknown(), note: z.unknown().optional() }).safeParse(req.body)
    // Negative is legal, as a `correction` (Q6): the payer may lower an
    // allowance, and the RPC REFUSES — never clamps — one that would fall below
    // what is already reserved or spent, because clamping invalidates a job
    // that is running right now.
    const input = creditsFromUnits(parsed.success ? parsed.data.units : undefined, { allowNegative: true })
    if (!input.ok) return reply.status(400).send(err(input.code, input.message))
    // The note's own refusal, with its own code and its own field named — see
    // `readNote`, which the absolute verb below shares so the cap and its two
    // codes cannot drift between the page's verb and the integration's.
    const noteInput = readNote(parsed.success ? parsed.data.note : undefined)
    if (!noteInput.ok) return reply.status(400).send(err(noteInput.code, noteInput.message))
    const note = noteInput.note

    const kind = input.credits > 0 ? "topup" : "correction"
    const result = await grantAllowance({
      userId: id,
      credits: input.credits,
      actorId,
      kind,
      note,
      // The credential that acted, never the actor: `granted_by` stays the
      // billing account (the key acts AS it), and the key's id is the separate
      // audit line the history renders as "via <key name>". Null is the page.
      credentialId: req.billingKey?.id ?? null,
    })
    if (!result.ok) {
      return reply.status(WRITE_STATUS[result.code]).send(err(result.code, WRITE_MESSAGE[result.code], result.message))
    }

    // The user's own balance readout caches for 15 s (credits.ts:135); without
    // this the person who was just topped up keeps seeing the old figure.
    invalidateBalanceCache(id)

    // Re-read rather than compute: for a user who has never generated, the RPC
    // seeds the row at the DEFAULT and writes TWO grant rows, so `granted`
    // comes back as default + top-up. Client-side arithmetic would show the
    // top-up alone and read as a lost default.
    const u = configuredUnit()
    const row = await allowanceLedgerOne(id)
    const { provisioned: _provisioned, ...figures } = ledgerInUnits(row, u)
    return reply.send({
      data: { userId: id, kind, credits: input.credits, units: inUnits(input.credits, u), allowance: figures },
    })
  })

  // -------------------------------------------------------------------------
  // PUT /users/:ref/allowance — the ABSOLUTE verbs: set and renew
  // -------------------------------------------------------------------------
  //
  // WHY ABSOLUTE. A back office knows "this customer's plan is 50 000", never
  // the delta from a figure it has not read. A delta computed on its side
  // turns a retry after a timeout into a second allocation; an absolute target
  // replayed is a no-op. That is the whole idempotency story, and it is why
  // this verb exists beside the additive `grant` rather than instead of it.
  //
  // THREE ANSWERS, and the caller branches on the status alone:
  //   200 — applied (or a `noop`, which is a success: the target was already
  //         the granted figure).
  //   202 — the person has no account yet, so the INTENT is stored against the
  //         identity their IdP will assert and applied at their first sign-in.
  //   4xx — a refusal, none of which wrote anything.
  app.put("/v1/deployment-billing/users/:ref/allowance", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG, { allowBillingKey: true })) return
    const actorId = req.userId
    if (!actorId) return reply.status(401).send(err("unauthorized", "Authentication required"))
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))

    // EVERY FIELD IS `unknown`, judged on its own — the coupling lesson from
    // the grant route above: a typed `note` fails the WHOLE object on an
    // over-long note, and the amount is then read as `undefined` and refused
    // by a code that names a field which was fine.
    const parsed = z
      .object({
        units: z.unknown(),
        mode: z.unknown().optional(),
        note: z.unknown().optional(),
        force: z.unknown().optional(),
      })
      .safeParse(req.body)
    const body: { units?: unknown; mode?: unknown; note?: unknown; force?: unknown } = parsed.success
      ? parsed.data
      : {}

    const mode = body.mode
    if (mode !== "set" && mode !== "renew") {
      return reply
        .status(WRITE_STATUS.allowance_mode_invalid)
        .send(err("allowance_mode_invalid", WRITE_MESSAGE.allowance_mode_invalid, 'mode must be "set" or "renew".'))
    }
    // ZERO IS LEGAL HERE and nowhere else: a cancelled plan is a quota of 0,
    // and refusing to express it would leave the last plan's figure standing.
    // Negative is not — a downgrade is a lower target, never a negative one.
    const input = creditsFromUnits(body.units, { allowNegative: false, allowZero: true })
    if (!input.ok) return reply.status(400).send(err(input.code, input.message))
    const noteInput = readNote(body.note)
    if (!noteInput.ok) return reply.status(400).send(err(noteInput.code, noteInput.message))
    const force = body.force === true
    const credentialId = req.billingKey?.id ?? null

    const outcome = await resolveRef((req.params as { ref?: string }).ref, reply)
    if (outcome.kind === "refused") return

    if (outcome.kind === "absent") {
      // A UUID CANNOT BE PENDING. Pending intents are keyed by the identity an
      // IdP will assert; a uuid is the studio's own id, which exists only
      // after an account does — so a uuid nobody answers to is a caller
      // holding a stale or wrong id, and saying so is the only useful answer.
      if (outcome.ref.id) {
        return reply
          .status(404)
          .send(err("user_not_found", "No account on this deployment has that id."))
      }
      const pending = await writePendingAllowance({
        ssoSubject: outcome.ref.ssoSubject ?? null,
        email: outcome.ref.email ?? null,
        targetCredits: input.credits,
        mode,
        note: noteInput.note,
        createdBy: actorId,
        credentialId,
      })
      if (!pending.ok) {
        return reply
          .status(WRITE_STATUS[pending.code])
          .send(err(pending.code, WRITE_MESSAGE[pending.code], pending.message))
      }
      // 202, not 200, so the caller can tell "stored, will apply" from
      // "applied" without parsing the body — and a replay REPLACES the stored
      // intent rather than queueing a second one, so the last figure sent is
      // the one that lands.
      return reply.status(202).send({ data: { status: "pending", expiresAt: pending.expiresAt } })
    }

    const userId = outcome.userId
    const u = configuredUnit()

    // THE MOST EXPENSIVE RULE IN THIS FILE. `renew` zeroes `spent`, and the
    // database will happily do it twice — so a duplicate webhook an hour after
    // the first would erase a period's real consumption and the customer would
    // be given back credits they had already used. The route owns the guard,
    // and `force` is how a genuine second period inside one day is expressed.
    if (mode === "renew" && !force) {
      const current = await allowanceLedgerOne(userId)
      if (current === null) {
        // The read failed, so "when was this last renewed?" has no answer.
        // Guessing "never" is the expensive direction, so this refuses with a
        // fault the caller retries rather than a business refusal it would
        // treat as final.
        return reply
          .status(503)
          .send(
            err(
              "read_failed",
              "Could not check when this allowance was last renewed. Nothing was changed — try again.",
            ),
          )
      }
      const last = current.resetAt ? Date.parse(current.resetAt) : Number.NaN
      if (Number.isFinite(last) && Date.now() - last < RENEWAL_MIN_INTERVAL_MS) {
        return reply
          .status(409)
          .send(
            err(
              "renewal_too_soon",
              "This allowance was renewed less than 24 hours ago. Send force: true only if a new period really started.",
              `resetAt ${current.resetAt}`,
            ),
          )
      }
    }

    const result = await setAllowance({
      userId,
      targetCredits: input.credits,
      actorId,
      mode,
      note: noteInput.note,
      credentialId,
    })
    if (!result.ok) {
      return reply.status(WRITE_STATUS[result.code]).send(err(result.code, WRITE_MESSAGE[result.code], result.message))
    }

    // The user's own balance readout caches for 15 s, so without this the
    // person whose quota just moved keeps seeing the old figure. A `noop`
    // moved nothing, and dropping the cache for it would make the page redraw
    // for a write that never happened.
    if (result.applied !== "noop") invalidateBalanceCache(userId)

    return reply.send({
      data: { userId, applied: result.applied, allowance: allowancePairs(result.row, u) },
    })
  })

  // -------------------------------------------------------------------------
  // POST /checkout — the payer buys Nodaro credits with its own card
  // -------------------------------------------------------------------------
  app.post("/v1/deployment-billing/checkout", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    // BEFORE `rejectProgrammaticAuth`, so a billing integration key is refused
    // with the code that says WHY (`payer_session_required`) rather than the
    // generic `forbidden` the bare call would send.
    if (refuseWithoutPayerSession(req, reply)) return
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG)) return
    const payerId = req.userId
    if (!payerId) return reply.status(401).send(err("unauthorized", "Authentication required"))

    // R4 — check the config, never getStripe(), which throws. A deployment
    // whose operator has not set the key is not broken; it is a deployment that
    // cannot take a card, and the page degrades honestly.
    if (!config.STRIPE_SECRET_KEY) {
      return reply
        .status(503)
        .send(
          err(
            "stripe_not_configured",
            "Card payment is not configured on this deployment. Contact Nodaro to add credits.",
          ),
        )
    }

    const parsed = z.object({ amountUsd: z.number().int().min(MIN_LOAD_USD).max(MAX_LOAD_USD) }).safeParse(req.body)
    if (!parsed.success) {
      // The cap is surfaced so the payer learns it from the product rather than
      // from a support ticket (T4).
      return reply
        .status(400)
        .send(
          err("invalid_amount", `amountUsd must be a whole dollar amount between ${MIN_LOAD_USD} and ${MAX_LOAD_USD}.`),
        )
    }
    const { amountUsd } = parsed.data
    const credits = creditsForLoadUsd(amountUsd)

    try {
      let stripeCustomerId: string | null = null
      const { data: existing } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", payerId)
        .single()
      const { data: profile } = await supabase.from("profiles").select("email").eq("id", payerId).single()
      const payerEmail = (profile as { email?: string | null } | null)?.email ?? null

      if (existing) {
        stripeCustomerId = (existing as { stripe_customer_id: string }).stripe_customer_id
      } else {
        const customer = await getStripe().customers.create({
          email: payerEmail ?? undefined,
          metadata: { userId: payerId },
        })
        stripeCustomerId = customer.id
        await ensureStripeCustomer(customer.id, payerId)
      }

      const baseUrl = getOrigin(req)
      const session = await getStripe().checkout.sessions.create({
        customer: stripeCustomerId ?? undefined,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amountUsd * 100,
              product_data: {
                name: `${credits.toLocaleString()} Nodaro credits`,
                description: "Deployment credit load — credits valid for 12 months",
              },
            },
            quantity: 1,
          },
        ],
        // BYTE-IDENTICAL to create-load-session's metadata, and that is the
        // whole of D14's "no webhook change": the webhook re-derives the grant
        // from the SETTLED amount through `creditsForLoadUsd` when it sees
        // `kind: "load"`, and credits `userId` — which here is the payer, the
        // account that holds the pool. A different shape here would take the
        // money and grant nothing.
        metadata: { userId: payerId, kind: "load", loadUsd: String(amountUsd) },
        payment_intent_data: {
          setup_future_usage: "off_session",
          ...(payerEmail ? { receipt_email: payerEmail } : {}),
        },
        // The stock routes return to /billing — a page `selfServe:false`
        // withholds — so the payer would pay and land nowhere.
        success_url: `${baseUrl}/billing-admin?topup=true`,
        cancel_url: `${baseUrl}/billing-admin`,
      })

      return reply.send({ data: { url: session.url, credits } })
    } catch (e) {
      console.error("[deployment-billing] checkout failed:", (e as Error).message)
      return reply.status(500).send(err("checkout_failed", "Could not start the payment session."))
    }
  })

  // =========================================================================
  // THE INTEGRATION'S READS — the pool, the usage rows, the price list
  // =========================================================================

  // -------------------------------------------------------------------------
  // GET /balance — the prepaid pool, and whether it is running low
  // -------------------------------------------------------------------------
  //
  // `/overview` answers this and more, and the page reads that. This is the
  // machine's version: the four figures an integration polls, plus a
  // `lowBalance` boolean computed HERE rather than in each caller, so two
  // integrations cannot hold two different ideas of what "low" means.
  app.get("/v1/deployment-billing/balance", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))

    const [pool, threshold] = await Promise.all([readPool(payerId), lowBalanceThreshold()])
    const total = pool.balance?.total ?? null

    return reply.send({
      data: {
        // RAW Nodaro credits — the one figure in this surface that is not in
        // display units, and labelled so by its own field name.
        balanceCredits: total,
        burn: pool.burn,
        periodEnd: pool.balance?.periodEnd ?? null,
        // BOTH must be known. A null balance means "we could not read it", and
        // comparing that against a threshold would silently treat it as 0 —
        // the loudest possible false alarm, raised exactly when the system is
        // already having a bad day.
        lowBalance: threshold !== null && total !== null && total < threshold,
        threshold,
      },
    })
  })

  // -------------------------------------------------------------------------
  // PUT /balance/threshold — what "low" means on this deployment
  // -------------------------------------------------------------------------
  app.put("/v1/deployment-billing/balance/threshold", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG, { allowBillingKey: true })) return
    const actorId = req.userId
    if (!actorId) return reply.status(401).send(err("unauthorized", "Authentication required"))
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    // The same actor assertion `setDefaultAllowance` makes in the service:
    // there is no RPC behind this column, so the check the database would have
    // made is made here instead — belt for the route guard's braces.
    if (actorId !== payerId) {
      return reply
        .status(WRITE_STATUS.allowance_actor_not_payer)
        .send(err("allowance_actor_not_payer", WRITE_MESSAGE.allowance_actor_not_payer))
    }

    // RAW CREDITS, not display units — the threshold is judged against the
    // pool, and the pool is the one figure this surface keeps in credits.
    const parsed = z.object({ credits: z.unknown() }).safeParse(req.body)
    const raw = parsed.success ? parsed.data.credits : undefined
    const threshold =
      raw === null ? null : typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined
    if (threshold === undefined) {
      return reply
        .status(400)
        .send(
          err(
            "invalid_threshold",
            "credits must be a whole number of Nodaro credits, zero or more — or null to clear the threshold.",
          ),
        )
    }

    const { data, error } = await supabase
      .from("deployment_payer_settings")
      .update({
        low_balance_threshold_credits: threshold,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true)
      .select("id")
    if (error) {
      console.error("[deployment-billing] threshold write failed:", error.message)
      return reply
        .status(WRITE_STATUS.allowance_write_failed)
        .send(err("allowance_write_failed", WRITE_MESSAGE.allowance_write_failed, error.message))
    }
    // An UPDATE that matches nothing is a success to PostgREST — here it means
    // the singleton the boot upsert should have written does not exist, and
    // answering 200 would report a save that went nowhere.
    if (Array.isArray(data) && data.length === 0) {
      return reply
        .status(WRITE_STATUS.allowance_unconfigured)
        .send(err("allowance_unconfigured", WRITE_MESSAGE.allowance_unconfigured))
    }

    return reply.send({ data: { threshold } })
  })

  // -------------------------------------------------------------------------
  // GET /usage — one row per generation, newest first, NEVER an aggregate
  // -------------------------------------------------------------------------
  //
  // The pool's own usage records, attributed to the person each generation ran
  // for. An aggregate here would be a number the caller could not reconcile
  // and could not re-cut by a different period, so this route emits rows and
  // the caller sums.
  //
  // KEYSET, not offset. An offset page over a table that is still being
  // written skips and repeats rows as new ones arrive at the top; the cursor
  // names the last row served and the next page is strictly older than it, so
  // a walk covers every row exactly once even while generations are landing.
  app.get("/v1/deployment-billing/usage", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const query = req.query as Record<string, string | undefined>
    const u = configuredUnit()

    const from = readInstant(query.from)
    const to = readInstant(query.to)
    if (from === "invalid" || to === "invalid") {
      return reply
        .status(400)
        .send(err("invalid_range", "from and to must be ISO 8601 timestamps."))
    }
    // The current UTC month by default — the same window `/overview` and
    // `/balance` call "this period", so a burn figure and a summed usage page
    // cannot disagree about when the period started.
    const fromIso = from ?? periodStart().toISOString()

    // A TRUE clamp into 1..500, unlike `paging()`'s `|| fallback` idiom above:
    // the published contract says 1 to 500, and `?limit=0` landing on 200
    // rather than on 1 would make a caller's own bound-check look wrong.
    const rawLimit = Number.parseInt(query.limit ?? "", 10)
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 200

    let onBehalfOf: string | null = null
    if (query.user !== undefined) {
      const outcome = await resolveRef(query.user, reply)
      if (outcome.kind === "refused") return
      if (outcome.kind === "absent") {
        // An EMPTY PAGE, not a 404. "Nobody by that name has generated" is a
        // true answer to this question, and a 404 would make a caller walking
        // its customer list treat a person who has not signed in yet as an
        // error rather than as zero usage.
        return reply.send({ data: [], nextCursor: null, from: fromIso, to: to ?? null, limit, unit: u })
      }
      onBehalfOf = outcome.userId
    }

    let keyset: { createdAt: string; id: string } | null = null
    if (query.cursor !== undefined && query.cursor !== "") {
      keyset = decodeUsageCursor(query.cursor)
      if (!keyset) {
        return reply
          .status(400)
          .send(err("invalid_cursor", "cursor must be a value this route returned as nextCursor."))
      }
    }

    let q = supabase
      .from("usage_logs")
      .select("id, created_at, job_id, action, provider, status, credits_used, on_behalf_of")
      // THE POOL. Every generation on this deployment is charged to the
      // billing account, so this predicate is what makes the page "the pool's
      // usage" rather than "one person's".
      .eq("user_id", payerId)
      .gte("created_at", fromIso)
    if (to !== null) q = q.lt("created_at", to)
    if (onBehalfOf !== null) q = q.eq("on_behalf_of", onBehalfOf)
    if (keyset !== null) {
      // `(created_at, id) < (c, i)`, spelled the way PostgREST can express it.
      // Both legs are STRICTLY less than: the row the cursor names was already
      // served, and `lte` on the timestamp would serve it a second time — a
      // double-counted generation in whatever sums this.
      //
      // The values are interpolated, and that is safe ONLY because
      // `decodeUsageCursor` has already proved they contain nothing but the
      // characters a timestamp and a uuid can hold. Raw query input never
      // reaches this string.
      q = q.or(
        `created_at.lt."${keyset.createdAt}",and(created_at.eq."${keyset.createdAt}",id.lt."${keyset.id}")`,
      )
    }
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit)

    if (error) {
      console.error("[deployment-billing] usage read failed:", error.message)
      return reply.status(500).send(err("read_failed", "Could not read this deployment's usage."))
    }

    const rows = (data ?? []) as ReadonlyArray<{
      id: string
      created_at: string
      job_id: string | null
      action: string | null
      provider: string | null
      status: string | null
      credits_used: number | null
      on_behalf_of: string | null
    }>

    // `on_behalf_of` is NULL on the billing account's own runs, which are
    // still real spend out of the pool — attributing them to the account that
    // made them keeps a per-requester sum equal to the pool's total, instead
    // of quietly losing staff generations.
    const requesterOf = (r: { on_behalf_of: string | null }) => r.on_behalf_of ?? payerId
    const requesterIds = [...new Set(rows.map(requesterOf))]
    const jobIds = [...new Set(rows.map((r) => r.job_id).filter((id): id is string => typeof id === "string"))]

    // TWO batched reads for the page, never one per row.
    const [profileRes, jobRes, subjects] = await Promise.all([
      requesterIds.length > 0
        ? supabase.from("profiles").select("id, email, full_name").in("id", requesterIds)
        : Promise.resolve({ data: [], error: null }),
      jobIds.length > 0
        ? supabase.from("jobs").select("id, job_type, provider").in("id", jobIds)
        : Promise.resolve({ data: [], error: null }),
      ssoSubjectsFor(requesterIds),
    ])
    if (profileRes.error) console.error("[deployment-billing] usage requester read failed:", profileRes.error.message)
    if (jobRes.error) console.error("[deployment-billing] usage job read failed:", jobRes.error.message)

    const profiles = new Map(
      ((profileRes.data ?? []) as ReadonlyArray<{ id: string; email: string | null; full_name: string | null }>).map(
        (p) => [p.id, p],
      ),
    )
    const jobs = new Map(
      ((jobRes.data ?? []) as ReadonlyArray<{ id: string; job_type: string | null; provider: string | null }>).map(
        (j) => [j.id, j],
      ),
    )

    const out = rows.map((r) => {
      const requesterId = requesterOf(r)
      const profile = profiles.get(requesterId)
      const job = r.job_id ? jobs.get(r.job_id) : undefined
      return {
        id: r.id,
        createdAt: r.created_at,
        jobId: r.job_id ?? null,
        jobType: job?.job_type ?? null,
        // The credit identifier the reservation was priced against, which is
        // what `/pricing` lists — so a row can be checked against a price.
        model: r.action ?? null,
        provider: r.provider ?? job?.provider ?? null,
        // `reserved` rows are not final: a generation reserves when it starts
        // and commits or refunds when it finishes, so a window that still
        // holds one has to be re-read before it is closed.
        status: r.status ?? null,
        credits: r.credits_used ?? null,
        units: inUnits(r.credits_used ?? null, u),
        requester: {
          id: requesterId,
          email: profile?.email ?? null,
          name: profile?.full_name ?? null,
          ssoSubject: subjects.get(requesterId) ?? null,
        },
      }
    })

    // Null on a SHORT page. A full final page still hands back a cursor whose
    // next page is empty — the walk ends on `null`, and it always comes.
    const last = rows.length === limit ? rows[rows.length - 1] : undefined
    return reply.send({
      data: out,
      nextCursor: last ? encodeUsageCursor(last.created_at, last.id) : null,
      from: fromIso,
      to: to ?? null,
      limit,
      unit: u,
    })
  })

  // -------------------------------------------------------------------------
  // GET /pricing — the effective price of every model this deployment offers
  // -------------------------------------------------------------------------
  //
  // Not the platform's public catalog (no markup, no narrowing) and not the
  // operator's pricing table (no narrowing, no display unit): the models THIS
  // deployment allows, at the cost a reservation would actually charge,
  // in both denominations.
  app.get("/v1/deployment-billing/pricing", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const query = req.query as Record<string, string | undefined>
    const u = configuredUnit()

    const since = readInstant(query.since)
    if (since === "invalid") {
      return reply.status(400).send(err("invalid_range", "since must be an ISO 8601 timestamp."))
    }
    const sinceMs = since === null ? null : Date.parse(since)

    // The allow-list is the deployment's narrowing when it has one; an EMPTY
    // allow-list means "nothing is narrowed away", not "no models", so the
    // catalog is the universe in that case. Both branches then go through
    // `isModelDenied`, which also honours the deny list and the operator's
    // availability override — pricing a model the picker no longer shows would
    // be a quote nobody can spend.
    const allow = runtimeSurfaceProfile().models.allow
    const ids = [...new Set(allow.length > 0 ? allow : Object.keys(MODEL_CATALOG))]
      .filter((id) => !isModelDenied(id))
      .sort()

    // ONE read for the whole list. `display_name` is not created by any
    // migration — production has drifted — so a database without it answers
    // 42703, and the retry without the column is the same posture
    // `/transactions` takes above.
    type PricingRow = {
      model_identifier: string
      display_name?: string | null
      category?: string | null
      is_enabled?: boolean | null
      updated_at?: string | null
    }
    const withName = await supabase
      .from("model_pricing")
      .select("model_identifier, display_name, category, is_enabled, updated_at")
      .in("model_identifier", ids)
    const pricingRows =
      withName.error?.code === "42703"
        ? await supabase
            .from("model_pricing")
            .select("model_identifier, category, is_enabled, updated_at")
            .in("model_identifier", ids)
        : withName
    if (pricingRows.error) {
      console.error("[deployment-billing] pricing read failed:", pricingRows.error.message)
      return reply.status(500).send(err("read_failed", "Could not read this deployment's price list."))
    }
    const byId = new Map(
      ((pricingRows.data ?? []) as ReadonlyArray<PricingRow>).map((r) => [r.model_identifier, r]),
    )

    // Per-model fault isolation: one unpriced identifier must not take the
    // whole list down, because the list is what tells the caller which one is
    // unpriced.
    const settled = await Promise.allSettled(ids.map((id) => CreditsService.getModelCreditCost(id)))

    const missing: string[] = []
    const errors: string[] = []
    let updatedAt: string | null = null

    const rows = ids.map((id, i) => {
      const entry = MODEL_CATALOG[id]
      const row = byId.get(id)
      const settledOne = settled[i]!
      let creditCost: number | null = null
      if (settledOne.status === "fulfilled") {
        creditCost = settledOne.value
      } else if (settledOne.reason instanceof PriceNotConfiguredError) {
        // Listed, and honestly empty. Dropping the row would say "this
        // deployment does not offer that model", which is a different and
        // wrong statement — the model IS offered, and its price is missing.
        missing.push(id)
      } else {
        errors.push(id)
        console.error(`[deployment-billing] pricing lookup failed for "${id}":`, settledOne.reason)
      }
      const rowUpdatedAt = row?.updated_at ?? null
      if (rowUpdatedAt !== null && (updatedAt === null || rowUpdatedAt > updatedAt)) updatedAt = rowUpdatedAt
      return {
        modelIdentifier: id,
        displayName: entry?.label ?? row?.display_name ?? null,
        category: row?.category ?? entry?.kind ?? null,
        kind: entry?.kind ?? null,
        modes: entry?.modes ?? null,
        // The EFFECTIVE cost, through the same call a reservation makes, so
        // the deployment's markup is included and a quoted price is the price.
        creditCost,
        units: inUnits(creditCost, u),
        // The catalog's own shape, so a metered model's per-second or
        // per-token rate is readable without a second call.
        pricing: entry?.pricing ?? null,
        isEnabled: row?.is_enabled ?? true,
        updatedAt: rowUpdatedAt,
      }
    })

    // `?since=` keeps only rows that have MOVED since then. A row with no
    // pricing row has no `updated_at` and therefore no evidence it changed, so
    // it is not a change — an empty list is the "nothing changed" answer, and
    // `updatedAt` still carries the whole list's high-water mark so the caller
    // can advance its bookmark without having received a row.
    const data =
      sinceMs === null
        ? rows
        : rows.filter((r) => r.updatedAt !== null && Date.parse(r.updatedAt) > sinceMs)

    const body = { data, missing, errors, updatedAt }
    // The tag is over the body WITHOUT itself — a hash cannot cover the field
    // that carries it — and the same value goes in the header and the body so
    // a caller that keeps only the JSON can still send `If-None-Match`.
    const etag = `"sha256-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`

    reply.header("ETag", etag)
    reply.header("Cache-Control", "private, max-age=300")

    const inm = req.headers["if-none-match"]
    if (typeof inm === "string" && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return reply.status(304).send()
    }

    return reply.send({ ...body, etag })
  })

  // =========================================================================
  // THE BILLING INTEGRATION KEYS — mint, list, revoke
  // =========================================================================
  //
  // The credential class the integration in the customer's back office holds
  // (spec §6.1): `ndr_bill_<64 hex>`, resolved in the auth hook, refused there
  // on every path outside `/v1/deployment-billing/`. These three routes issue
  // and withdraw it, and all three are BROWSER-SESSION-ONLY — a key must not be
  // able to enumerate or mint or revoke keys, its own included.
  //
  // Three gates, deliberately redundant and deliberately in different files:
  // `requireDeploymentPayer` (identity), `refuseWithoutPayerSession` (the
  // credential kind, with the code that says why) and a bare
  // `rejectProgrammaticAuth` (no `allowBillingKey`, so it refuses the key a
  // second time along with every other programmatic caller). Any one of the
  // three going missing must not open this surface.
  //
  // R9 — KEY MATERIAL. The bearer exists in exactly one response body, once:
  // the mint route's. It is never logged, never stored unhashed, and never
  // echoed by a read — `GET` returns the 12-character prefix, and not even the
  // hash, which against a known 9-character prefix would be a verifier worth
  // cracking.

  /** What the page sees. Neither the bearer nor its hash is in this shape, and
   *  the resolver never selects the hash column in the first place. */
  const renderKey = (row: BillingKeyRow) => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    revokedAt: row.revoked_at ?? null,
    allowedCidrs: row.allowed_cidrs ?? null,
  })

  /** The column is bare `text`, and this route is the only enforcement point —
   *  the same reasoning as the grant note's cap above. */
  const KEY_NAME_MAX = 80
  /** A source allow-list is a handful of egress addresses, not a routing table. */
  const MAX_ALLOWED_CIDRS = 20

  // -------------------------------------------------------------------------
  // GET /integration-keys — every key, live and dead
  // -------------------------------------------------------------------------
  app.get("/v1/deployment-billing/integration-keys", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    if (refuseWithoutPayerSession(req, reply)) return
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG)) return

    const rows = await listBillingKeys()
    if (!rows) return reply.status(500).send(err("read_failed", "Could not read this deployment's integration keys."))
    // Revoked and expired rows are included on purpose: the payer has to be
    // able to see WHY a key stopped working, not merely that it is gone.
    return reply.send({ data: rows.map(renderKey) })
  })

  // -------------------------------------------------------------------------
  // POST /integration-keys — mint one, and show the bearer exactly once
  // -------------------------------------------------------------------------
  app.post("/v1/deployment-billing/integration-keys", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    if (refuseWithoutPayerSession(req, reply)) return
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG)) return
    const payerId = req.userId
    if (!payerId) return reply.status(401).send(err("unauthorized", "Authentication required"))

    const body = (req.body ?? {}) as Record<string, unknown>

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (name.length === 0 || name.length > KEY_NAME_MAX) {
      return reply
        .status(400)
        .send(err("invalid_name", `name must be between 1 and ${KEY_NAME_MAX} characters.`))
    }

    let expiresAt: string | null = null
    if (body.expiresAt !== undefined && body.expiresAt !== null) {
      const raw = body.expiresAt
      const at = typeof raw === "string" ? Date.parse(raw) : Number.NaN
      // A key minted already expired is a key that never worked and whose
      // failure looks exactly like a revocation — refuse it at the door.
      if (!Number.isFinite(at) || at <= Date.now()) {
        return reply
          .status(400)
          .send(err("invalid_expiry", "expiresAt must be an ISO 8601 timestamp in the future."))
      }
      expiresAt = new Date(at).toISOString()
    }

    let allowedCidrs: string[] | null = null
    if (body.allowedCidrs !== undefined && body.allowedCidrs !== null) {
      const raw = body.allowedCidrs
      if (!Array.isArray(raw) || raw.length > MAX_ALLOWED_CIDRS) {
        return reply
          .status(400)
          .send(err("invalid_cidr", `allowedCidrs must be a list of at most ${MAX_ALLOWED_CIDRS} network blocks.`))
      }
      const normalized: string[] = []
      for (const entry of raw) {
        // Refused, never silently masked: `10.0.0.1/24` is a typo, and widening
        // it to `10.0.0.0/24` would grant a range the payer did not ask for —
        // while passing it through would be a 500 from the `cidr` column.
        const one = normalizeCidr(entry)
        if (one === null) {
          return reply
            .status(400)
            .send(
              err(
                "invalid_cidr",
                "Each entry of allowedCidrs must be an IP address or a network block with no host bits set " +
                  "(for example 203.0.113.9 or 10.0.0.0/8).",
              ),
            )
        }
        normalized.push(one)
      }
      allowedCidrs = normalized.length > 0 ? normalized : null
    }

    const existing = await listBillingKeys()
    if (!existing) {
      return reply.status(500).send(err("read_failed", "Could not read this deployment's integration keys."))
    }
    if (countLiveBillingKeys(existing) >= MAX_LIVE_BILLING_KEYS) {
      return reply
        .status(409)
        .send(
          err(
            "key_limit_reached",
            `This deployment already has ${MAX_LIVE_BILLING_KEYS} live integration keys. ` +
              "Revoke one before creating another.",
          ),
        )
    }

    const minted = await mintBillingKey({ name, expiresAt, allowedCidrs, createdBy: payerId })
    if (!minted.ok) {
      return reply.status(500).send(err("key_write_failed", "The integration key could not be created."))
    }

    // THE ONLY PLACE `token` EVER APPEARS. Nothing above logged it, nothing
    // below stores it, and no read route can produce it again.
    return reply.status(201).send({
      data: {
        id: minted.row.id,
        name: minted.row.name,
        token: minted.token,
        tokenPrefix: minted.row.token_prefix,
        expiresAt: minted.row.expires_at ?? null,
      },
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /integration-keys/:id — revoke, and stop it working now
  // -------------------------------------------------------------------------
  app.delete(
    "/v1/deployment-billing/integration-keys/:id",
    { preHandler: requireDeploymentPayer },
    async (req, reply) => {
      if (refuseWithoutPayerSession(req, reply)) return
      if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG)) return

      const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params)
      if (!parsed.success) {
        return reply.status(400).send(err("invalid_key_id", "That is not an integration key id."))
      }

      const result = await revokeBillingKey(parsed.data.id)
      if (result === "write_failed") {
        return reply.status(500).send(err("key_write_failed", "The integration key could not be revoked."))
      }
      // An unknown id and an already-revoked one answer the same, because they
      // mean the same thing: there is no LIVE key with that id. Keeping the
      // original `revoked_at` matters more than distinguishing them — it is the
      // audit fact, and a replayed DELETE must not move it.
      if (result === "not_found") {
        return reply.status(404).send(err("key_not_found", "No live integration key with that id."))
      }
      // The resolver's cache was dropped inside `revokeBillingKey`, in the same
      // call as the write: a revocation that waited out the 60-second TTL would
      // leave the key working for a minute after the payer was told otherwise.
      return reply.send({ data: { id: parsed.data.id, revoked: true } })
    },
  )
}
