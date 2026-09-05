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
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { CreditsService } from "../billing/credits.js"
import { getStripe } from "../billing/stripe-client.js"
import { ensureStripeCustomer } from "../billing/provision-credits.js"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "../billing/load-rate.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { requireDeploymentPayer, PAYER_JWT_ONLY_MSG } from "../middleware/require-deployment-payer.js"
import { allowanceEnforcementActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { runtimeSurfaceProfile } from "../../lib/surface-profile.js"
import { toUnits } from "../../lib/billing-display-unit.js"
import { invalidateBalanceCache } from "./credits.js"
import {
  allowanceLedgerFor,
  allowanceLedgerOne,
  defaultAllowanceCredits,
  grantAllowance,
  grantsFor,
  provisionedUserCount,
  setDefaultAllowance,
  type AllowanceLedgerRow,
  type AllowanceWriteErrorCode,
} from "../billing/deployment-allowance-service.js"

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
 */
function creditsFromUnits(raw: unknown, opts: { allowNegative: boolean }): UnitInput {
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
  if (raw === 0 || (raw < 0 && !opts.allowNegative)) {
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

// ---------------------------------------------------------------------------

export async function deploymentBillingRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /overview — the pool, the burn, the default, the counts
  // -------------------------------------------------------------------------
  app.get("/v1/deployment-billing/overview", { preHandler: requireDeploymentPayer }, async (req, reply) => {
    const payerId = deploymentPayerId()
    if (!payerId) return reply.status(404).send(err("not_found", "Not found"))
    const u = configuredUnit()
    const since = periodStart()

    // Client-side aggregation, capped — the `/usage` provider's posture. At the
    // cap the figure under-reports and says so, rather than pretending.
    const BURN_CAP = 5000
    const [balance, burnRows, userCount, provisionedCount, defaultCredits] = await Promise.all([
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
      supabase.from("profiles").select("id", { count: "exact", head: true }).neq("id", payerId),
      // Through the service, never a direct read: the allowance tables are
      // named in exactly one file so the D7 no-row rule cannot be forgotten in
      // a second place.
      provisionedUserCount(),
      defaultAllowanceCredits(),
    ])

    const rows = burnRows.error ? [] : ((burnRows.data ?? []) as ReadonlyArray<{ credits_used: number | null }>)
    if (burnRows.error) console.error("[deployment-billing] burn read failed:", burnRows.error.message)
    const burnCredits = burnRows.error ? null : rows.reduce((sum, r) => sum + (r.credits_used ?? 0), 0)

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
        burn: {
          periodStart: since.toISOString(),
          credits: burnCredits,
          generations: burnRows.error ? null : rows.length,
          capped: rows.length === BURN_CAP,
        },
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
    const ledger = await allowanceLedgerFor(rows.map((r) => r.id))

    return reply.send({
      data: rows.map((r) => ({ ...r, ...ledgerInUnits(ledger?.get(r.id) ?? null, u) })),
      total: count ?? 0,
      limit,
      offset,
      unit: u,
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
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG)) return
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
    if (rejectProgrammaticAuth(req, reply, PAYER_JWT_ONLY_MSG)) return
    const actorId = req.userId
    if (!actorId) return reply.status(401).send(err("unauthorized", "Authentication required"))
    const { id } = req.params as { id: string }

    if (id === deploymentPayerId()) {
      // D13: the payer holds the real credits. An allowance for it would be a
      // quota against its own pool — a concept that does not exist — and a row
      // for it would make its own runs refusable at the flip.
      return reply
        .status(400)
        .send(
          err(
            "payer_has_no_allowance",
            "The billing account holds the deployment's credits and has no allowance. Buy credits instead.",
          ),
        )
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
    // The note's own refusal, with its own code and its own field named. The
    // 500-char cap has no client counterpart (the column is bare `text`), so
    // this is the only place it is enforced; fail-closed, before any RPC call,
    // so nothing is written and the retry is safe.
    const rawNote = parsed.success ? parsed.data.note : undefined
    if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
      return reply.status(400).send(err("invalid_note", "note must be text."))
    }
    if (typeof rawNote === "string" && rawNote.length > NOTE_MAX_CHARS) {
      return reply
        .status(400)
        .send(err("note_too_long", `The note is too long — keep it to ${NOTE_MAX_CHARS} characters or fewer.`))
    }
    const note = typeof rawNote === "string" ? rawNote : null

    const kind = input.credits > 0 ? "topup" : "correction"
    const result = await grantAllowance({ userId: id, credits: input.credits, actorId, kind, note })
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
  // POST /checkout — the payer buys Nodaro credits with its own card
  // -------------------------------------------------------------------------
  app.post("/v1/deployment-billing/checkout", { preHandler: requireDeploymentPayer }, async (req, reply) => {
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
}
