import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { CreditsService, invalidateModelPricingCache } from "../billing/credits.js"
import { invalidateBalanceCache } from "../routes/credits.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"
import { invalidateAuthCache } from "../../middleware/auth.js"
import { invalidateAdminCache } from "../../lib/admin-check.js"
import { TIER_CREDITS } from "../billing/stripe-config.js"
import { tierColumns, resolveTierFrom } from "../billing/tier-columns.js"
import { resolveEffectiveTier } from "@nodaro/shared"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { allowanceFor, allowancesFor } from "../billing/deployment-allowance-service.js"
import { runtimeSurfaceProfile } from "../../lib/surface-profile.js"
import { toUnits } from "../../lib/billing-display-unit.js"
import type { UserAllowance } from "../../types/deployment-allowance.js"

// ---- Zod Schemas ----

const adjustCreditsBody = z.object({
  amount: z.number(),
  creditType: z.enum(["subscription", "topup"]),
  description: z.string().min(1),
  adminUserId: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Deployment-payer redaction (spec D11 / §8.3)
// ---------------------------------------------------------------------------
//
// On a deployment where one account pays for everyone, an admin is NOT a
// billing role: the credits on every `profiles` row are the deployment's own
// money, and the payer's row IS Nodaro's balance. Migration 381 hides that row
// from the browser through RLS; these routes are the other way in, because they
// run as the service role, which no policy constrains.
//
// Everything below is inert on mainline: `deploymentPayerActive()` is false and
// `deploymentPayerId()` is null with no `billing.payerAccount`, so the query,
// the column string and the response body are byte-for-byte today's.

/** Today's column string, unchanged — mainline must ask for exactly this. */
const USER_COLUMNS =
  "id, display_name, avatar_url, tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, created_at"

/**
 * Under a payer the admin page can no longer read `profiles` from the browser
 * (381 narrows the policy, and the credit columns are withheld anyway), so this
 * route becomes its data source and must carry the three identity columns the
 * page renders. Added ONLY on the payer branch: mainline still uses the
 * browser-direct read and must receive the same body it does today.
 *
 * `display_name` IS REMOVED HERE, and that is not tidying: `profiles` HAS NO
 * SUCH COLUMN (see frontend/src/types/database.types.ts, and routes/me.ts:33 —
 * "the human-readable name lives in `full_name`"). PostgREST refuses the whole
 * request with `column "display_name" does not exist`, this route maps any
 * query error to a 500, and under a payer that is the ONLY source the admin
 * users page has — so the list would be dead on exactly the deployments this
 * branch exists for. Nothing downstream loses anything: the route passes rows
 * through and neither the page nor `AdminUser` reads `display_name`.
 *
 * MAINLINE'S `USER_COLUMNS` STILL NAMES IT, deliberately untouched: that string
 * is pinned byte-for-byte by admin-users-payer-redaction.test.ts, mainline
 * reaches this route through no shipped caller (the admin page reads `profiles`
 * browser-direct, use-admin-queries.ts:248), and widening the blast radius of
 * a payer fix to Nodaro Cloud's own route is not this change's business. It is
 * a latent defect on that lane and wants its own triage.
 */
const USER_COLUMNS_PAYER = `${USER_COLUMNS.replace("display_name, ", "")}, email, full_name, role`

/**
 * Raw Nodaro credits → the deployment's display unit (`unitLabel`), the ONE
 * conversion (`toUnits`, R3). `null` stays null all the way to the screen's em
 * dash: 0 is a real value meaning "exhausted", and manufacturing it for "not
 * known yet" is the lie this whole track is careful about. Answers null when no
 * unit is configured, which cannot co-occur with an allowance in practice —
 * `coherentBilling` drops `allowances` when the unit trio is incoherent — but
 * is guarded rather than assumed.
 */
function saiUnits(credits: number | null | undefined): number | null {
  const b = runtimeSurfaceProfile().billing
  const rate = b.unitRate
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null
  return toUnits(credits, rate, b.unitDecimals ?? 0)
}

/**
 * The three `sai_*` figures for one user, in units.
 *
 * `sai_spent` is the SETTLED figure (`spent_credits`) and is deliberately NOT
 * `granted − remaining`: that difference also contains `reserved` — credits
 * held by a job still running — and rendering an in-flight reservation as money
 * already spent would be wrong in the one direction an admin would act on.
 */
function saiFigures(a: UserAllowance | null): {
  sai_granted: number | null
  sai_remaining: number | null
  sai_spent: number | null
} {
  return {
    sai_granted: saiUnits(a?.granted ?? null),
    sai_remaining: saiUnits(a?.remaining ?? null),
    sai_spent: saiUnits(a?.spent ?? null),
  }
}

/**
 * True when this caller may not look at this id. The payer's ledger belongs to
 * the payer alone (the billing account's own page, `/billing-admin`); an admin
 * asking for it by id is the service-role half of the same leak 381 closes in
 * RLS. Null payer id ⇒ never true ⇒ mainline untouched.
 */
function refusesPayerRow(id: string, callerId: string | undefined): boolean {
  const payerId = deploymentPayerId()
  return payerId !== null && id === payerId && callerId !== payerId
}

const PAYER_ROW_FORBIDDEN = {
  error: {
    code: "forbidden",
    message: "This account's balance is visible only to the deployment's billing account.",
  },
}

export async function adminCreditsRoutes(app: FastifyInstance) {
  // GET /v1/admin/users - List all users with credit info (paginated)
  app.get("/v1/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10) || 50))
    const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0)
    const search = query.search?.trim() ?? null

    const payerActive = deploymentPayerActive()
    const payerId = deploymentPayerId()

    let dbQuery = supabase
      .from("profiles")
      // `tier` as well as `subscription_tier`: the Stripe paths historically
      // wrote only `tier`, so a paying customer could show here as "free".
      // resolveTierFrom() picks the same column credit enforcement does.
      .select(payerActive ? USER_COLUMNS_PAYER : USER_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    // The payer's row is dropped at the QUERY, not in the map: it must not be
    // in the count, on the page, or in a log line of this response.
    if (payerActive && payerId) dbQuery = dbQuery.neq("id", payerId)

    if (search) {
      // Strict allowlist: letters and digits in ANY script (this instance's
      // display names are Hebrew — an ASCII-only allowlist reduced "דנה כהן" to
      // a bare space, which matched nearly everyone), combining marks so
      // niqqud stays attached, spaces, and email characters. PostgREST filter
      // syntax (parentheses, commas, colons) still cannot get through.
      const sanitized = search.replace(/[^\p{L}\p{N}\p{M}\s@.\-]/gu, "").trim()
      if (sanitized.length > 0) {
        // Same split as the projection, for the same reason: on the payer
        // branch the searchable name column is `full_name` (the one that
        // exists, and the one the page renders); mainline's filter is left
        // byte-identical.
        dbQuery = dbQuery.or(
          payerActive
            ? `full_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
            : `display_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`,
        )
      }
    }

    const { data, count, error } = await dbQuery

    if (error) return reply.code(500).send({ error: error.message })

    // The select string is a ternary, so PostgREST's literal-type inference
    // cannot name the row shape; the fields read below are exactly the ones
    // both column strings contain.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>

    // One batch read for the page — never a per-row query, and never a direct
    // read of the allowance table itself: the D7 no-row rule lives in the
    // service and must not be re-derived here. Null (no payer, or the read
    // failed) renders as an em dash, not as zero; the figures are visible
    // whether or not enforcement has been flipped on.
    const allowances = payerActive ? await allowancesFor(rows.map((u) => u.id)) : null

    const users = rows.map((u) => {
      const common = {
        // Report the tier that is actually enforced, not the raw column — see
        // tier-columns.ts for why the two can disagree.
        subscription_tier: resolveTierFrom(u as { tier?: string | null; subscription_tier?: string | null }),
        // Derived entitlement tier ("payg" when stored-free with net lifetime
        // top-ups). Read-only display — the admin tier enum never gains payg.
        effective_tier: resolveEffectiveTier({
          tier: (u.tier as string | null) ?? null,
          subscription_tier: (u.subscription_tier as string | null) ?? null,
          lifetime_topup_credits: (u.lifetime_topup_credits as number) ?? 0,
        }),
      }
      if (!payerActive) {
        return {
          ...u,
          ...common,
          total_credits: ((u.subscription_credits as number) ?? 0) + ((u.topup_credits as number) ?? 0),
        }
      }
      // Under a payer EVERY Nodaro credit figure is dropped (§9.2, which the
      // orchestrator ruled over D11's narrower three-column list): these are
      // the deployment's money sitting in columns the user never spends, and
      // a deployment admin is not a billing role for a wallet they cannot touch.
      // `total_credits` is not recomputed — it is dropped; the only spend
      // figure that survives is `sai_spent`, in display units, below.
      //
      // `lifetime_topup_credits` is READ FIRST, by `common.effective_tier`
      // above: the derived tier depends on it, so the order of these two
      // statements is load-bearing.
      const {
        subscription_credits: _sub,
        topup_credits: _top,
        daily_spent_credits: _daily,
        lifetime_topup_credits: _lifetime,
        ...rest
      } = u
      return { ...rest, ...common, ...saiFigures(allowances?.get(u.id) ?? null) }
    })

    return { data: users, total: count ?? 0, limit, offset }
  })

  // GET /v1/admin/users/:id/balance - Get detailed balance for a user
  app.get("/v1/admin/users/:id/balance", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (refusesPayerRow(id, request.userId)) return reply.code(403).send(PAYER_ROW_FORBIDDEN)
    if (deploymentPayerActive()) {
      // Under a payer a user's own credit columns are a frozen signup grant
      // nothing debits — an honest zero would still be a number an admin can
      // act on. The allowance is the only figure that means anything here.
      return saiFigures(await allowanceFor(id))
    }
    try {
      const balance = await CreditsService.getBalance(id)
      return balance
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })

  // POST /v1/admin/users/:id/credits - Admin adjust credits
  app.post("/v1/admin/users/:id/credits", { preHandler: requirePlatformOperator }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = adjustCreditsBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0]?.message ?? "Invalid request: amount (number), creditType (subscription|topup), description, adminUserId required",
      })
    }
    const { amount, creditType, description, adminUserId } = parsed.data

    try {
      const result = await CreditsService.adminAdjustCredits({
        userId: id,
        amount,
        creditType,
        description,
        adminUserId,
      })
      invalidateBalanceCache(id)
      return result
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })

  // GET /v1/admin/users/:id/transactions - Credit transaction history
  app.get("/v1/admin/users/:id/transactions", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (refusesPayerRow(id, request.userId)) return reply.code(403).send(PAYER_ROW_FORBIDDEN)
    const query = request.query as Record<string, string | undefined>
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10) || 50))
    const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0)

    // credit_type='org' rows (pool grants/variance, 351) are org ledger lines
    // that happen to carry an actor's id — not this user's history. 42703 =
    // pre-351 schema; no org rows can exist there, same answer unfiltered.
    let { data, error } = await supabase
      .from("credit_transactions")
      .select("*")
      .eq("user_id", id)
      .is("org_id", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (error?.code === "42703") {
      ;({ data, error } = await supabase
        .from("credit_transactions")
        .select("*")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1))
    }

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /v1/admin/users/:id/subscription - Latest subscription row, incl.
  // scheduled-cancellation state (cancel_at / cancel_at_period_end are synced
  // from Stripe by the subscription.updated webhook; status stays "active"
  // until the period actually ends).
  app.get("/v1/admin/users/:id/subscription", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, stripe_subscription_id, tier, status, current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: error.message })
    return { data }
  })

  // PUT /v1/admin/users/:id/tier - Admin change user tier
  app.put("/v1/admin/users/:id/tier", { preHandler: requirePlatformOperator }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const tierBody = z.object({
      tier: z.enum(["free", "basic", "standard", "pro", "business"]),
      adminUserId: z.string().uuid().optional(),
    }).safeParse(request.body)
    if (!tierBody.success) {
      return reply.code(400).send({ error: tierBody.error.issues[0]?.message ?? "Invalid request" })
    }
    const { tier, adminUserId: bodyAdminUserId } = tierBody.data
    const adminUserId = request.userId ?? bodyAdminUserId ?? ""

    // Fetch current profile
    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, subscription_credits, topup_credits")
      .eq("id", id)
      .single()

    if (fetchError || !profile) {
      return reply.code(404).send({ error: "User not found" })
    }

    const oldTier = resolveTierFrom(profile)
    if (oldTier === tier) {
      return reply.code(200).send({ message: "Tier unchanged", tier })
    }

    const newCredits = TIER_CREDITS[tier] ?? 50

    // Update tier + reset subscription credits
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        ...tierColumns(tier),
        subscription_credits: newCredits,
      })
      .eq("id", id)

    if (updateError) {
      return reply.code(500).send({ error: updateError.message })
    }

    // Log transaction for the credit reset
    const totalAfter = newCredits + (profile.topup_credits ?? 0)
    const creditDelta = newCredits - (profile.subscription_credits ?? 0)

    try {
      await CreditsService.adminAdjustCredits({
        userId: id,
        amount: 0,
        creditType: "subscription",
        description: `Tier changed from ${oldTier} to ${tier} (credits reset to ${newCredits})`,
        adminUserId,
      })
    } catch {
      // Transaction log failure is non-critical; tier already updated
    }

    invalidateBalanceCache(id)
    return { tier, subscription_credits: newCredits, total_credits: totalAfter, credit_delta: creditDelta }
  })

  // PUT /v1/admin/users/:id/storage - Admin change user storage limit
  app.put("/v1/admin/users/:id/storage", { preHandler: requirePlatformOperator }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const storageBody = z.object({
      storageLimitBytes: z.number().int().positive(),
    }).safeParse(request.body)
    if (!storageBody.success) {
      return reply.code(400).send({ error: storageBody.error.issues[0]?.message ?? "storageLimitBytes must be a positive number" })
    }
    const { storageLimitBytes } = storageBody.data

    // Fetch current limit
    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("storage_limit_bytes")
      .eq("id", id)
      .single()

    if (fetchError || !profile) {
      return reply.code(404).send({ error: "User not found" })
    }

    const previousLimit = profile.storage_limit_bytes ?? 0

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ storage_limit_bytes: storageLimitBytes })
      .eq("id", id)

    if (updateError) {
      return reply.code(500).send({ error: updateError.message })
    }

    return { storage_limit_bytes: storageLimitBytes, previous_limit: previousLimit }
  })

  // PUT /v1/admin/users/:id/role - Admin change user role (super_admin only)
  app.put("/v1/admin/users/:id/role", { preHandler: requirePlatformOperator }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const roleBody = z.object({
      role: z.enum(["user", "admin", "super_admin"]),
    }).safeParse(request.body)
    if (!roleBody.success) {
      return reply.code(400).send({ error: roleBody.error.issues[0]?.message ?? "Invalid role" })
    }
    const { role } = roleBody.data

    // Verify requesting user is super_admin
    const { data: adminProfile, error: adminError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", request.userId!)
      .single()

    if (adminError || !adminProfile) {
      return reply.code(403).send({ error: "Admin user not found" })
    }
    if (adminProfile.role !== "super_admin") {
      return reply.code(403).send({ error: "Only super_admin can change user roles" })
    }

    // Prevent self-demotion
    if (request.userId === id) {
      return reply.code(400).send({ error: "Cannot change your own role" })
    }

    // Protect the original super_admin (owner). Configured via
    // PLATFORM_OWNER_EMAIL; empty (self-host default) means no protected owner.
    const OWNER_EMAIL = config.PLATFORM_OWNER_EMAIL
    const { data: targetProfile, error: targetError } = await supabase
      .from("profiles")
      .select("email, role")
      .eq("id", id)
      .single()

    if (targetError || !targetProfile) {
      return reply.code(404).send({ error: "User not found" })
    }
    if (OWNER_EMAIL && targetProfile.email === OWNER_EMAIL) {
      return reply.code(403).send({ error: "Cannot change the role of the platform owner" })
    }

    const previousRole = targetProfile.role ?? "user"
    if (previousRole === role) {
      return reply.code(200).send({ message: "Role unchanged", role })
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", id)

    if (updateError) {
      return reply.code(500).send({ error: updateError.message })
    }

    // Invalidate auth + admin caches so the new role takes effect immediately
    // (the admin-verdict cache is separate from the token cache; without this a
    // demoted admin keeps admin access until the 5-min TTL expires).
    invalidateAuthCache(id)
    invalidateAdminCache(id)

    return { role, previous_role: previousRole }
  })

  // GET /v1/admin/models - List all models with pricing
  app.get("/v1/admin/models", { preHandler: requireAdmin }, async (request, reply) => {
    const { data, error } = await supabase
      .from("model_pricing")
      .select("*")
      .order("credit_cost", { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // PUT /v1/admin/models/:identifier/pricing - Update model pricing
  app.put("/v1/admin/models/:identifier/pricing", { preHandler: requirePlatformOperator }, async (request, reply) => {
    const { identifier } = request.params as { identifier: string }
    const pricingBody = z.object({
      creditCost: z.number().int().min(0).optional(),
      isEnabled: z.boolean().optional(),
      tierRestriction: z.string().nullable().optional(),
    }).safeParse(request.body)
    if (!pricingBody.success) {
      return reply.code(400).send({ error: pricingBody.error.issues[0]?.message ?? "Invalid request" })
    }
    const { creditCost, isEnabled, tierRestriction } = pricingBody.data

    const updates: Record<string, unknown> = {}
    if (creditCost !== undefined) updates.credit_cost = creditCost
    if (isEnabled !== undefined) updates.is_enabled = isEnabled
    if (tierRestriction !== undefined) updates.tier_restriction = tierRestriction

    const { data, error } = await supabase
      .from("model_pricing")
      .update(updates)
      .eq("model_identifier", identifier)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    invalidateModelPricingCache()
    return data
  })

  // GET /v1/admin/credits/summary - Platform-wide credit stats
  app.get("/v1/admin/credits/summary", { preHandler: requireAdmin }, async (request, reply) => {
    // Under a payer this aggregate IS the payer's balance, in four different
    // ways, so the whole route is refused to anyone but the payer (D11/§8.3).
    //
    // `totalCreditsOutstanding` is SUM(subscription_credits + topup_credits)
    // over ALL profiles — the payer's row included. Under a payer every other
    // profile holds the same frozen signup grant G that nothing debits, and G
    // is on the caller's own GET /v1/user/credits, so
    // `payer_balance = totalCreditsOutstanding − (totalUsers−1)·G` exactly; two
    // polls give the burn rate. `tierBreakdown` isolates the payer by
    // inspection (it is the only paid-tier account), and `totalTransactions` is
    // the payer's own activity volume. Redacting one field would leave three.
    //
    // Refusing rather than subtracting also keeps this route from disagreeing
    // with `/v1/admin/users`, which drops the payer AT THE QUERY (:137): a
    // server-side subtraction here would still publish a `totalUsers` and a
    // `tierBreakdown` that count a row the other route says does not exist.
    // Nothing consumes this route on a payer deployment — no frontend caller,
    // no test — so nothing is lost by closing it.
    //
    // MAINLINE IS BYTE-IDENTICAL: `deploymentPayerActive()` is false with no
    // `billing.payerAccount`, so this guard never fires and the body below is
    // untouched.
    if (deploymentPayerActive() && request.userId !== deploymentPayerId()) {
      return reply.code(403).send(PAYER_ROW_FORBIDDEN)
    }

    // Use SQL aggregate RPC instead of fetching ALL profiles
    const { data, error } = await supabase.rpc("get_credit_summary")

    if (error || !data) {
      console.error("[admin-credits] get_credit_summary RPC failed:", error?.message)
      return { totalUsers: 0, totalCreditsOutstanding: 0, tierBreakdown: {}, totalTransactions: 0 }
    }

    const result = data as Record<string, unknown>
    return {
      totalUsers: result.totalUsers ?? 0,
      totalCreditsOutstanding: result.totalCreditsOutstanding ?? 0,
      tierBreakdown: (result.tierBreakdown as Record<string, number>) ?? {},
      totalTransactions: result.totalTransactions ?? 0,
    }
  })
}
