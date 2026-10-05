import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { networkKey } from "../../lib/ip-address.js"
import { clientAddress, networkHash, networkHashScheme, resolveClientAddress } from "../../lib/client-address.js"
import { accessBlocksStatus, invalidateAccessBlocks } from "../../lib/access-blocks.js"
import { isMissingTableError } from "../../lib/postgrest-errors.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { invalidateAuthCache } from "../../middleware/auth.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { keyToken } from "../lib/signup-signal-clusters.js"
import { recordAdminAction } from "../lib/admin-actions.js"
import {
  BLOCK_REFUSAL_MESSAGE,
  BlocksUnavailableError,
  blockRefusal,
  convergeSignInBan,
  deleteBlockRow,
  readSignInBan,
  writeBlockRow,
} from "../lib/account-blocking.js"
import {
  BLOCK_DURATION_DAYS,
  DEFAULT_BLOCK_DAYS,
  RANGE_REFUSAL_MESSAGE,
  collateralOf,
  expiryFromDays,
  needsSuperAdmin,
  rangeToBlock,
  signupNetworkOf,
  type BlockDurationDays,
} from "../lib/network-blocking.js"

/**
 * Admin access controls: block / unblock an account, block / unblock a
 * network, and how the server sees the caller.
 *
 * Plain admin gate (`requireAdmin`), and deliberately so: nothing here moves
 * money. The block dialog's "also take back free credits" is a SECOND request,
 * to the free-grant routes (admin-free-grants.ts), which sit behind the same
 * money gate as adjusting credits (`requirePlatformOperator`). Network blocks
 * a super admin had to place (`super_admin_only`) only a super admin lifts.
 *
 * Every change is written to `admin_actions` (unblocking deletes the block row,
 * so that table is the only history) and invalidates this process's block
 * snapshot at once; the other processes follow within one refresh (30 s).
 *
 * Before migration 458 reaches the shared database (staging runs ahead of it)
 * the writes answer 503 `blocks_unavailable` and the list says `ready: false`.
 */

/** Same keying as the free-grant cluster tokens, so the two pages agree. */
const TOKEN_SECRET = config.SUPABASE_SERVICE_ROLE_KEY

const ADMIN_WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

/** The Blocks page lists the newest this many of each, and says when there are more. */
const LIST_LIMIT = 500

/**
 * An account id in its one spelling. Postgres and GoTrue resolve an upper-case
 * uuid to the same account, so a raw id compared as a string (the self and
 * billing-account refusals) could be dodged by changing its case.
 */
const accountId = z.uuid().transform((s) => s.toLowerCase())

const userParams = z.object({ id: accountId })
const blockBody = z.object({ reason: z.string().trim().max(500).optional() })
const networkParams = z.object({ id: z.uuid().transform((s) => s.toLowerCase()) })
const networkBody = z
  .object({
    userId: accountId.optional(),
    address: z.string().trim().min(1).max(64).optional(),
    label: z.string().trim().max(200).optional(),
    days: z
      .number()
      .int()
      .refine((d): d is BlockDurationDays => (BLOCK_DURATION_DAYS as readonly number[]).includes(d))
      .optional(),
  })
  .refine((b) => (b.userId === undefined) !== (b.address === undefined), {
    message: "Give exactly one of userId or address",
  })

const BLOCKS_UNAVAILABLE = {
  error: { code: "blocks_unavailable", message: "Blocking is not available on this database yet." },
} as const

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "validation_error", message } })
}

/** The caller's role, read fresh — a super_admin gate must not trust a cache. */
async function isSuperAdmin(req: FastifyRequest): Promise<boolean> {
  if (!req.userId) return false
  const { data } = await supabase.from("profiles").select("role").eq("id", req.userId).maybeSingle()
  return (data as { role?: string | null } | null)?.role === "super_admin"
}

/** The admin's own network hash (refused as a block target). */
function ownNetworkHash(req: FastifyRequest): string | null {
  const address = clientAddress(req)
  const key = address ? networkKey(address) : null
  return key ? networkHash(key) : null
}

export async function adminAccessRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/access/whoami — how the server sees the CALLER: the address
   * the shared derivation (`lib/client-address.ts`) decided, the hop it came
   * through, and the network token admin pages show for it. Reads no database
   * and returns nothing about anyone else. Also allowed on the `mcp.*` host
   * (`middleware/mcp-host-filter.ts`), which reaches the backend without Caddy.
   */
  app.get("/v1/admin/access/whoami", { preHandler: requireAdmin }, async (req) => {
    const detail = resolveClientAddress(req)
    const key = detail.address ? networkKey(detail.address) : null
    const { scheme } = networkHashScheme()
    return {
      data: {
        address: detail.address,
        source: detail.source,
        hop: detail.hop,
        header: detail.header,
        network: key,
        networkToken: key ? keyToken(networkHash(key), TOKEN_SECRET) : null,
        hashScheme: scheme,
      },
    }
  })

  /** GET /v1/admin/access/blocks — blocked accounts, live network blocks, and the snapshot's health. */
  app.get("/v1/admin/access/blocks", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const status = await accessBlocksStatus()
      // One row past the page tells the page the list was cut (the newest first).
      const { data: blocks, error } = await supabase
        .from("account_blocks")
        .select("user_id, reason, blocked_by, created_at")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT + 1)
      if (error) {
        if (isMissingTableError(error)) {
          return { data: { ready: false, status, users: [], networks: [], usersTruncated: false, networksTruncated: false } }
        }
        return sendInternalError(reply, req, error, "Failed to list blocks")
      }
      const { data: nets, error: netError } = await supabase
        .from("blocked_networks")
        .select("id, network_hash, cidr, label, source_user_id, created_by, created_at, expires_at, super_admin_only")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT + 1)
      if (netError) return sendInternalError(reply, req, netError, "Failed to list blocks")

      const allBlocks = (blocks ?? []) as Array<{ user_id: string; reason: string | null; blocked_by: string | null; created_at: string }>
      const allNets = (nets ?? []) as Array<{
        id: string
        network_hash: string | null
        cidr: string | null
        label: string | null
        source_user_id: string | null
        created_by: string | null
        created_at: string
        expires_at: string
        super_admin_only: boolean | null
      }>
      const blockRows = allBlocks.slice(0, LIST_LIMIT)
      const netRows = allNets.slice(0, LIST_LIMIT)
      const ids = [
        ...new Set([
          ...blockRows.flatMap((b) => [b.user_id, b.blocked_by]),
          ...netRows.flatMap((n) => [n.source_user_id, n.created_by]),
        ].filter((x): x is string => typeof x === "string")),
      ]
      const emails = new Map<string, string>()
      for (let i = 0; i < ids.length; i += 100) {
        const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", ids.slice(i, i + 100))
        for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) emails.set(p.id, p.email ?? "")
      }
      return {
        data: {
          ready: true,
          status,
          users: blockRows.map((b) => ({
            userId: b.user_id,
            email: emails.get(b.user_id) ?? null,
            reason: b.reason,
            blockedBy: b.blocked_by ? (emails.get(b.blocked_by) ?? null) : null,
            blockedAt: b.created_at,
          })),
          networks: netRows.map((n) => ({
            id: n.id,
            range: n.cidr,
            token: n.network_hash ? keyToken(n.network_hash, TOKEN_SECRET) : null,
            label: n.label,
            fromUser: n.source_user_id ? (emails.get(n.source_user_id) ?? null) : null,
            blockedBy: n.created_by ? (emails.get(n.created_by) ?? null) : null,
            blockedAt: n.created_at,
            expiresAt: n.expires_at,
            superAdminOnly: n.super_admin_only === true,
          })),
          usersTruncated: allBlocks.length > LIST_LIMIT,
          networksTruncated: allNets.length > LIST_LIMIT,
        },
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to list blocks")
    }
  })

  /** GET /v1/admin/users/:id/access — one account's block, sign-in ban and signup network. */
  app.get("/v1/admin/users/:id/access", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = userParams.safeParse(req.params)
    if (!parsed.success) return badRequest(reply, "Invalid user id")
    const userId = parsed.data.id
    try {
      const { data: block, error } = await supabase
        .from("account_blocks")
        .select("reason, created_at")
        .eq("user_id", userId)
        .maybeSingle()
      const ready = !(error && isMissingTableError(error))
      if (error && ready) return sendInternalError(reply, req, error, "Failed to read access")
      const ban = await readSignInBan(userId)
      const network = await signupNetworkOf(userId)
      let networkInfo: Record<string, unknown> | null = null
      if (network) {
        const collateral = await collateralOf(network.hash, userId)
        let blocked = false
        if (ready) {
          const { data: live } = await supabase
            .from("blocked_networks")
            .select("id")
            .eq("network_hash", network.hash)
            .gt("expires_at", new Date().toISOString())
            .maybeSingle()
          blocked = live !== null
        }
        networkInfo = {
          token: keyToken(network.hash, TOKEN_SECRET),
          blockable: network.blockable,
          signupAt: network.signupAt,
          otherAccounts: collateral.otherAccounts,
          payingAccounts: collateral.payingAccounts,
          needsSuperAdmin: needsSuperAdmin(collateral),
          blocked,
        }
      }
      return {
        data: {
          ready,
          blocked: Boolean(block),
          reason: (block as { reason?: string | null } | null)?.reason ?? null,
          blockedAt: (block as { created_at?: string } | null)?.created_at ?? null,
          signInBlocked: ban?.signInBlocked ?? null,
          signInBanIsOurs: ban?.ours ?? null,
          network: networkInfo,
        },
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read access")
    }
  })

  /** POST /v1/admin/users/:id/block — freeze an account. Idempotent: pressing it again repairs a half-applied block. */
  app.post("/v1/admin/users/:id/block", { preHandler: requireAdmin, config: ADMIN_WRITE_LIMIT }, async (req, reply) => {
    const params = userParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, "Invalid user id")
    const body = blockBody.safeParse(req.body ?? {})
    if (!body.success) return badRequest(reply, "The reason is at most 500 characters")
    const userId = params.data.id
    try {
      const refusal = await blockRefusal(req.userId!, userId)
      if (refusal) {
        return reply.status(refusal === "not_found" ? 404 : 403).send({ error: { code: refusal, message: BLOCK_REFUSAL_MESSAGE[refusal] } })
      }
      const reason = body.data.reason || null
      await writeBlockRow(userId, req.userId!, reason)
      // The role was read BEFORE the write: an account promoted in between
      // would end up a blocked admin. Ask again now that the row exists, and
      // take the row back if the answer changed. (Promoting a blocked account
      // is refused on the role route, which closes the other order.)
      const late = await blockRefusal(req.userId!, userId)
      if (late) {
        await deleteBlockRow(userId)
        invalidateAccessBlocks()
        return reply.status(late === "not_found" ? 404 : 403).send({ error: { code: late, message: BLOCK_REFUSAL_MESSAGE[late] } })
      }
      invalidateAccessBlocks()
      invalidateAuthCache(userId)
      let signInBlocked = false
      let warning: string | null = null
      try {
        signInBlocked = (await convergeSignInBan(userId)).signInBlocked
      } catch (err) {
        req.log.error({ err, userId }, "block: sign-in ban failed")
        warning = "The account is blocked, but blocking its sign-in failed. Press Block again to retry."
      }
      await recordAdminAction(req, "account_block", userId, { signInBlocked }, reason)
      return { data: { userId, blocked: true, signInBlocked, warning } }
    } catch (err) {
      if (err instanceof BlocksUnavailableError) return reply.status(503).send(BLOCKS_UNAVAILABLE)
      return sendInternalError(reply, req, err, "Failed to block the account")
    }
  })

  /** POST /v1/admin/users/:id/unblock — lift the block, and the sign-in ban only if a block placed it. */
  app.post("/v1/admin/users/:id/unblock", { preHandler: requireAdmin, config: ADMIN_WRITE_LIMIT }, async (req, reply) => {
    const params = userParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, "Invalid user id")
    const userId = params.data.id
    try {
      const removed = await deleteBlockRow(userId)
      invalidateAccessBlocks()
      invalidateAuthCache(userId)
      let signInBlocked: boolean | null = null
      let warning: string | null = null
      try {
        signInBlocked = (await convergeSignInBan(userId)).signInBlocked
      } catch (err) {
        req.log.error({ err, userId }, "unblock: lifting the sign-in ban failed")
        warning = "The account is unblocked, but lifting its sign-in block failed. Press Unblock again to retry."
      }
      await recordAdminAction(req, "account_unblock", userId, { removed, signInBlocked })
      return { data: { userId, blocked: false, signInBlocked, warning } }
    } catch (err) {
      if (err instanceof BlocksUnavailableError) return reply.status(503).send(BLOCKS_UNAVAILABLE)
      return sendInternalError(reply, req, err, "Failed to unblock the account")
    }
  })

  /**
   * POST /v1/admin/access/networks — block an account's signup network or a
   * typed address/range, for 1 / 7 / 30 (default) / 90 days.
   */
  app.post("/v1/admin/access/networks", { preHandler: requireAdmin, config: ADMIN_WRITE_LIMIT }, async (req, reply) => {
    const parsed = networkBody.safeParse(req.body ?? {})
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid request")
    const { userId, address, label } = parsed.data
    const days = (parsed.data.days ?? DEFAULT_BLOCK_DAYS) as BlockDurationDays
    try {
      const superAdmin = await isSuperAdmin(req)
      let target: { network_hash: string } | { cidr: string }
      let collateral: Record<string, unknown> = {}
      let superAdminOnly = false

      if (userId) {
        const network = await signupNetworkOf(userId)
        if (!network) return reply.status(404).send({ error: { code: "not_found", message: "This account has no recorded signup network." } })
        if (!network.blockable) {
          return reply.status(409).send({ error: { code: "not_blockable", message: RANGE_REFUSAL_MESSAGE.not_blockable } })
        }
        if (network.hash === ownNetworkHash(req)) {
          return reply.status(409).send({ error: { code: "own_network", message: RANGE_REFUSAL_MESSAGE.own_signup_network } })
        }
        const c = await collateralOf(network.hash, userId)
        collateral = { otherAccounts: c.otherAccounts, payingAccounts: c.payingAccounts, targetPaying: c.targetPaying }
        superAdminOnly = needsSuperAdmin(c)
        if (superAdminOnly && !superAdmin) {
          return reply.status(403).send({ error: { code: "needs_super_admin", message: RANGE_REFUSAL_MESSAGE.needs_super_admin } })
        }
        target = { network_hash: network.hash }
      } else {
        const range = rangeToBlock(address!, { superAdmin, adminAddress: clientAddress(req) })
        if ("refusal" in range) {
          const status = range.refusal === "too_wide_for_admin" ? 403 : range.refusal === "invalid_address" ? 400 : 409
          return reply.status(status).send({ error: { code: range.refusal, message: RANGE_REFUSAL_MESSAGE[range.refusal] } })
        }
        target = { cidr: range.cidr }
        superAdminOnly = range.superAdminOnly
      }

      const row: Record<string, unknown> = {
        ...target,
        label: label || null,
        source_user_id: userId ?? null,
        created_by: req.userId,
        super_admin_only: superAdminOnly,
        expires_at: expiryFromDays(days),
      }
      const { data, error } = await supabase
        .from("blocked_networks")
        .upsert(row, { onConflict: "network_hash" in target ? "network_hash" : "cidr" })
        .select("id, cidr, network_hash, expires_at")
        .single()
      if (error) {
        if (isMissingTableError(error)) return reply.status(503).send(BLOCKS_UNAVAILABLE)
        return sendInternalError(reply, req, error, "Failed to block the network")
      }
      invalidateAccessBlocks()
      const saved = data as { id: string; cidr: string | null; network_hash: string | null; expires_at: string }
      await recordAdminAction(
        req,
        "network_block",
        saved.id,
        { range: saved.cidr, fromUser: userId ?? null, days, superAdminOnly, ...collateral },
        label || null,
      )
      return {
        data: {
          id: saved.id,
          range: saved.cidr,
          token: saved.network_hash ? keyToken(saved.network_hash, TOKEN_SECRET) : null,
          expiresAt: saved.expires_at,
          superAdminOnly,
        },
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to block the network")
    }
  })

  /** DELETE /v1/admin/access/networks/:id — lift a network block. */
  app.delete("/v1/admin/access/networks/:id", { preHandler: requireAdmin, config: ADMIN_WRITE_LIMIT }, async (req, reply) => {
    const parsed = networkParams.safeParse(req.params)
    if (!parsed.success) return badRequest(reply, "Invalid block id")
    try {
      const { data: existing, error: readError } = await supabase
        .from("blocked_networks")
        .select("id, super_admin_only")
        .eq("id", parsed.data.id)
        .maybeSingle()
      if (readError) {
        if (isMissingTableError(readError)) return reply.status(503).send(BLOCKS_UNAVAILABLE)
        return sendInternalError(reply, req, readError, "Failed to lift the network block")
      }
      if (!existing) return reply.status(404).send({ error: { code: "not_found", message: "No such network block." } })
      if ((existing as { super_admin_only?: boolean | null }).super_admin_only === true && !(await isSuperAdmin(req))) {
        return reply
          .status(403)
          .send({ error: { code: "super_admin_to_lift", message: RANGE_REFUSAL_MESSAGE.super_admin_to_lift } })
      }
      const { data, error } = await supabase.from("blocked_networks").delete().eq("id", parsed.data.id).select("id, cidr")
      if (error) {
        if (isMissingTableError(error)) return reply.status(503).send(BLOCKS_UNAVAILABLE)
        return sendInternalError(reply, req, error, "Failed to lift the network block")
      }
      if (!Array.isArray(data) || data.length === 0) {
        return reply.status(404).send({ error: { code: "not_found", message: "No such network block." } })
      }
      invalidateAccessBlocks()
      await recordAdminAction(req, "network_unblock", parsed.data.id, { range: (data[0] as { cidr: string | null }).cidr })
      return { data: { id: parsed.data.id, removed: true } }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to lift the network block")
    }
  })
}
