import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"
import { activateSignupGrant } from "../billing/signup-grant.js"
import {
  buildClusters,
  chunk,
  isMissingFunctionError,
  keyToken,
  mergeRelated,
  uniqueIds,
  HYDRATION_CHUNK,
  RELATED_MAX,
  RELATED_PER_AXIS_LIMIT,
  type ClusterRow,
  type ProfileRow,
  type SignalRow,
} from "../lib/signup-signal-clusters.js"

/**
 * Free-credit abuse gate: admin review of withheld grants.
 *
 * Read is admin; RESTORE is platform-operator, because restoring mints 1,500
 * credits — the same gate as the credit-adjust route. There is deliberately
 * no "confirm withhold" write: withheld is already the state, and the only
 * action an operator can take that changes money is to grant.
 */

const listQuery = z.object({
  state: z.enum(["withheld", "granted", "unclaimed"]).default("withheld"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const userParams = z.object({ userId: z.uuid() })

/**
 * HMAC key for the display tokens (see `keyToken`). The service-role key is
 * always present (config requires it), never leaves the backend, and an HMAC
 * reveals nothing about its key — it is a keying material of convenience, not a
 * second secret to rotate.
 */
const CLUSTER_TOKEN_SECRET = config.SUPABASE_SERVICE_ROLE_KEY

const clustersQuery = z.object({
  axis: z.enum(["device", "browser", "ip"]).default("device"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** `.in()` is a GET query param — chunk or a NAT cluster builds an unsendable URL. */
async function hydrateProfiles(ids: readonly string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>()
  for (const part of chunk(ids, HYDRATION_CHUNK)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, subscription_credits, free_grant_state")
      .in("id", part)
    if (error) throw error
    for (const p of (data ?? []) as ProfileRow[]) map.set(p.id, p)
  }
  return map
}

async function hydrateSignals(ids: readonly string[]): Promise<Map<string, SignalRow>> {
  const map = new Map<string, SignalRow>()
  for (const part of chunk(ids, HYDRATION_CHUNK)) {
    const { data, error } = await supabase
      .from("signup_signals")
      .select("user_id, created_at, reasons")
      .in("user_id", part)
      .eq("source", "claim")
    if (error) throw error
    for (const s of (data ?? []) as SignalRow[]) map.set(s.user_id, s)
  }
  return map
}

export async function adminFreeGrantRoutes(app: FastifyInstance) {
  /** GET /v1/admin/free-grants?state=withheld — newest first, with the reasons. */
  app.get("/v1/admin/free-grants", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }
    const { state, limit, offset } = parsed.data

    try {
      const { data: profiles, error, count } = await supabase
        .from("profiles")
        .select("id, email, full_name, created_at, subscription_credits, free_grant_state", { count: "exact" })
        .eq("free_grant_state", state)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) return sendInternalError(reply, req, error, "Failed to list free grants")

      const ids = (profiles ?? []).map((p) => p.id as string)
      const signalsById = new Map<string, { decision: string | null; reasons: string[]; decided_at: string | null }>()
      if (ids.length > 0) {
        const { data: signals } = await supabase
          .from("signup_signals")
          .select("user_id, decision, reasons, decided_at")
          .in("user_id", ids)
          .eq("source", "claim")
        for (const s of signals ?? []) {
          signalsById.set(s.user_id as string, {
            decision: (s.decision as string | null) ?? null,
            reasons: Array.isArray(s.reasons) ? (s.reasons as string[]) : [],
            decided_at: (s.decided_at as string | null) ?? null,
          })
        }
      }

      return {
        data: (profiles ?? []).map((p) => ({
          userId: p.id,
          email: p.email,
          fullName: p.full_name,
          createdAt: p.created_at,
          subscriptionCredits: p.subscription_credits,
          state: p.free_grant_state,
          reasons: signalsById.get(p.id as string)?.reasons ?? [],
          decidedAt: signalsById.get(p.id as string)?.decided_at ?? null,
        })),
        total: count ?? 0,
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to list free grants")
    }
  })

  /** POST /v1/admin/free-grants/:userId/activate — restore a withheld grant. */
  app.post("/v1/admin/free-grants/:userId/activate", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const parsed = userParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid user id" } })
    }
    try {
      const result = await activateSignupGrant(parsed.data.userId, "Free signup grant (restored by admin)")
      if (!result.activated) {
        return reply.status(409).send({
          error: { code: "not_withheld", message: `Account is '${result.state}', nothing to restore` },
        })
      }
      req.log.info({ userId: parsed.data.userId, adminId: req.userId }, "free grant restored by admin")
      return { data: { userId: parsed.data.userId, state: result.state } }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to restore the free grant")
    }
  })

  /**
   * GET /v1/admin/free-grants/clusters?axis=device|browser|ip
   *
   * Accounts that claimed from the same machine, browser profile or network.
   * Reads are admin (same gate as the withheld list); nothing here writes.
   *
   * TOLERATES A MISSING FUNCTION ON PURPOSE. Migrations reach the database only
   * on a push to main, so staging serves this code for days before 373 exists.
   * A "function not found" is answered with an empty, flagged page rather than a
   * 500 the operator would report as an outage.
   */
  app.get("/v1/admin/free-grants/clusters", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = clustersQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }
    const { axis, limit, offset } = parsed.data

    try {
      const { data, error } = await supabase.rpc("signup_signal_clusters", {
        p_axis: axis,
        p_limit: limit,
        p_offset: offset,
      })
      if (error) {
        if (isMissingFunctionError(error)) {
          req.log.warn({ axis }, "signup_signal_clusters is not in the database yet — serving unavailable")
          return { data: [], total: 0, axis, unavailable: true }
        }
        return sendInternalError(reply, req, error, "Failed to load signup clusters")
      }

      const rows = (data ?? []) as ClusterRow[]
      // count(*) OVER () rides on the rows, so a page past the last cluster has
      // no row to carry the total. Probe the first row rather than report zero.
      let total = Number(rows[0]?.total_count ?? 0)
      if (rows.length === 0 && offset > 0) {
        const probe = await supabase.rpc("signup_signal_clusters", { p_axis: axis, p_limit: 1, p_offset: 0 })
        if (!probe.error) total = Number((probe.data as ClusterRow[] | null)?.[0]?.total_count ?? 0)
      }
      const ids = uniqueIds(rows)
      const [profiles, signals] = ids.length
        ? await Promise.all([hydrateProfiles(ids), hydrateSignals(ids)])
        : [new Map<string, ProfileRow>(), new Map<string, SignalRow>()]

      return {
        data: buildClusters(rows, profiles, signals, CLUSTER_TOKEN_SECRET),
        total,
        axis,
        unavailable: false,
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to load signup clusters")
    }
  })

  /**
   * GET /v1/admin/free-grants/:userId/related — the other accounts that share
   * this one's browser profile, machine, or network. Needs no RPC (365's table
   * and indexes are already in production), so it has no unavailable state.
   */
  app.get("/v1/admin/free-grants/:userId/related", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = userParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid user id" } })
    }
    const { userId } = parsed.data

    try {
      const { data: own, error: ownError } = await supabase
        .from("signup_signals")
        .select("browser_key, device_key, ip_hash, created_at")
        .eq("user_id", userId)
        .eq("source", "claim")
        .maybeSingle()
      if (ownError) return sendInternalError(reply, req, ownError, "Failed to load related accounts")
      if (!own) return { data: { userId, signal: null, related: [], truncated: false } }

      const byAxis = async (column: "device_key" | "browser_key" | "ip_hash", value: string) => {
        const { data, error } = await supabase
          .from("signup_signals")
          .select("user_id, created_at, reasons")
          .eq(column, value)
          .eq("source", "claim")
          .neq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(RELATED_PER_AXIS_LIMIT)
        if (error) throw error
        return (data ?? []) as SignalRow[]
      }

      // Order matters: device, browser, ip — `matches` and the test's queued
      // results both read in this order.
      const [deviceRows, browserRows, ipRows] = await Promise.all([
        own.device_key ? byAxis("device_key", own.device_key as string) : Promise.resolve<SignalRow[]>([]),
        own.browser_key ? byAxis("browser_key", own.browser_key as string) : Promise.resolve<SignalRow[]>([]),
        byAxis("ip_hash", own.ip_hash as string),
      ])

      const perAxis = [
        { axis: "device" as const, rows: deviceRows },
        { axis: "browser" as const, rows: browserRows },
        { axis: "ip" as const, rows: ipRows },
      ]
      const ids = [...new Set(perAxis.flatMap((a) => a.rows.map((r) => r.user_id)))]
      // Each axis is capped and the merged list is capped again; say so, or the
      // UI cannot tell "200 related accounts" from "200 of 500".
      const truncated = perAxis.some((a) => a.rows.length >= RELATED_PER_AXIS_LIMIT) || ids.length > RELATED_MAX
      const profiles = ids.length ? await hydrateProfiles(ids) : new Map<string, ProfileRow>()

      return {
        data: {
          userId,
          signal: {
            browserKeyPrefix: keyToken(own.browser_key as string | null, CLUSTER_TOKEN_SECRET),
            deviceKeyPrefix: keyToken(own.device_key as string | null, CLUSTER_TOKEN_SECRET),
            ipHashPrefix: keyToken(own.ip_hash as string, CLUSTER_TOKEN_SECRET) ?? "",
            signalAt: own.created_at as string,
          },
          related: mergeRelated(perAxis, profiles),
          truncated,
        },
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to load related accounts")
    }
  })
}
