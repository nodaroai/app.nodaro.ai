import type { FastifyInstance } from "fastify"
import { hasCredits } from "../lib/config.js"
import { checkStorageQuota } from "../utils/file-validation.js"
import { sendInternalError } from "../lib/http-errors.js"
import { recordStorageWarnCrossing } from "../lib/storage-warn.js"

/**
 * GET /v1/storage/status — the caller's storage picture, for client apps
 * (voice.nodaro.ai) that show a usage meter without owning the quota model.
 *
 * Response: `{ usedBytes: number, limitBytes: number | null }` — null means
 * unlimited/unknown (self-hosted editions don't track or enforce storage).
 * Deliberately minimal and additive-safe: new fields may be added, these two
 * never change meaning.
 *
 * Source of truth: `checkStorageQuota` (utils/file-validation.ts) — the same
 * profile read (`storage_used_bytes`, `storage_limit_bytes`, `tier`) and the
 * same effective-limit resolution (admin-set DB limit unless absent or the
 * stale 500MB sentinel, else the tier ladder) that `/v1/upload`'s quota gate
 * and the `reserve_storage_if_within_limit` RPC (migration 089) apply. Passing
 * 0 bytes makes it a pure read: both the within-quota and over-quota branches
 * return the numbers; only a missing profile doesn't.
 */
export async function storageStatusRoutes(app: FastifyInstance) {
  app.get("/v1/storage/status", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Self-hosted (community/business): no tracking, no limit — report an
    // explicit "unlimited/unknown" rather than stale profile bytes that
    // nothing updates on these editions.
    if (!hasCredits()) {
      return { usedBytes: 0, limitBytes: null }
    }

    const quota = await checkStorageQuota(userId, 0)
    if (quota.usedBytes === undefined || quota.quotaBytes === undefined) {
      return sendInternalError(
        reply,
        req,
        new Error(quota.error ?? "storage status unavailable"),
        "Failed to load storage status",
      )
    }

    // Stamp the first crossing of the storage warning threshold.
    // This read is exactly what turns the client meter amber, so stamping here
    // makes "the meter warned them" and "they crossed" the same population by
    // construction. Not awaited and never throws — see storage-warn.ts.
    void recordStorageWarnCrossing(userId, quota.usedBytes, quota.quotaBytes)

    return { usedBytes: quota.usedBytes, limitBytes: quota.quotaBytes }
  })
}
