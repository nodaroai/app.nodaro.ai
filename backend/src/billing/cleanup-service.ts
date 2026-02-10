import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { deleteFromR2 } from "../lib/storage.js"
import { updateStorageUsage } from "../utils/file-validation.js"

// ============================================================
// Types
// ============================================================

interface CleanupResult {
  readonly filesDeleted: number
  readonly bytesFreed: number
  readonly errors: number
}

interface ExpiryResult {
  readonly usersDowngraded: number
  readonly errors: number
}

interface WarningResult {
  readonly warnings80: number
  readonly warnings95: number
  readonly warningsFull: number
}

// ============================================================
// Constants
// ============================================================

const BATCH_SIZE = 100
const MEDIA_RETENTION_DAYS = 60
const FREE_TIER_DEFAULTS = {
  tier: "free",
  subscription_credits: 50,
  storage_limit_bytes: 524288000, // 500 MB
} as const

// ============================================================
// Helpers
// ============================================================

/**
 * Extract R2 key from a public R2 URL.
 * Returns null if the URL doesn't match the R2 public URL pattern.
 */
function r2KeyFromUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL || !url.startsWith(config.R2_PUBLIC_URL)) {
    return null
  }
  return url.replace(config.R2_PUBLIC_URL + "/", "")
}

/**
 * Extract all R2 URLs from job output_data.
 * output_data may contain imageUrl, videoUrl, audioUrl, or nested stem URLs.
 */
function extractR2UrlsFromOutput(outputData: Record<string, unknown>): string[] {
  const urls: string[] = []

  for (const [key, value] of Object.entries(outputData)) {
    if (typeof value === "string" && value.startsWith(config.R2_PUBLIC_URL)) {
      urls.push(value)
    }
    // Handle nested objects (e.g., suno-separate stems)
    if (key.endsWith("Url") && typeof value === "string" && value.startsWith("http")) {
      if (!urls.includes(value)) urls.push(value)
    }
  }

  return urls
}

/**
 * Delete a single R2 file by key, returning the freed bytes.
 * Returns 0 if deletion fails (best-effort).
 */
async function safeDeleteR2(r2Key: string): Promise<boolean> {
  try {
    await deleteFromR2(r2Key)
    return true
  } catch (err) {
    console.error(`[cleanup] Failed to delete R2 key ${r2Key}:`, err)
    return false
  }
}

// ============================================================
// A) Clean up media for Free-tier users (>60 days old)
// ============================================================

export async function cleanupFreeUserMedia(): Promise<CleanupResult> {
  let filesDeleted = 0
  let bytesFreed = 0
  let errors = 0

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - MEDIA_RETENTION_DAYS)
  const cutoff = cutoffDate.toISOString()

  // Step 1: Get free-tier user IDs
  const { data: freeUsers, error: usersError } = await supabase
    .from("profiles")
    .select("id")
    .or("tier.eq.free,tier.is.null")
    .limit(1000)

  if (usersError || !freeUsers || freeUsers.length === 0) {
    if (usersError) console.error("[cleanup] Failed to query free users:", usersError.message)
    return { filesDeleted: 0, bytesFreed: 0, errors: usersError ? 1 : 0 }
  }

  const freeUserIds = freeUsers.map((u) => u.id)

  // --- Phase A1: Clean assets table ---
  let hasMoreAssets = true
  while (hasMoreAssets) {
    const { data: assets, error } = await supabase
      .from("assets")
      .select("id, user_id, r2_key, size_bytes")
      .in("user_id", freeUserIds)
      .not("r2_key", "is", null)
      .lt("created_at", cutoff)
      .limit(BATCH_SIZE)

    if (error) {
      console.error("[cleanup] Failed to query free user assets:", error.message)
      errors++
      break
    }

    if (!assets || assets.length === 0) {
      hasMoreAssets = false
      break
    }

    for (const asset of assets) {
      if (!asset.r2_key) continue

      const deleted = await safeDeleteR2(asset.r2_key)
      if (deleted) {
        const size = asset.size_bytes ?? 0
        bytesFreed += size

        // Null out r2_key to mark as cleaned
        await supabase
          .from("assets")
          .update({ r2_key: null, r2_url: null })
          .eq("id", asset.id)

        // Decrement storage
        if (size > 0 && asset.user_id) {
          await updateStorageUsage(asset.user_id, -size).catch(() => {})
        }

        filesDeleted++
      } else {
        errors++
      }
    }

    // If we got fewer than BATCH_SIZE, we're done
    if (assets.length < BATCH_SIZE) hasMoreAssets = false
  }

  // --- Phase A2: Clean job output files ---
  let hasMoreJobs = true
  while (hasMoreJobs) {
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, user_id, output_data")
      .in("user_id", freeUserIds)
      .eq("status", "completed")
      .not("output_data", "is", null)
      .lt("created_at", cutoff)
      .limit(BATCH_SIZE)

    if (error) {
      console.error("[cleanup] Failed to query free user jobs:", error.message)
      errors++
      break
    }

    if (!jobs || jobs.length === 0) {
      hasMoreJobs = false
      break
    }

    for (const job of jobs) {
      const output = job.output_data as Record<string, unknown> | null
      if (!output) continue

      const urls = extractR2UrlsFromOutput(output)
      let jobBytesFreed = 0

      for (const url of urls) {
        const r2Key = r2KeyFromUrl(url)
        if (!r2Key) continue

        const deleted = await safeDeleteR2(r2Key)
        if (deleted) {
          filesDeleted++
        } else {
          errors++
        }
      }

      // Mark output_data as cleaned (set URLs to null)
      const cleanedOutput: Record<string, unknown> = { ...output, _cleaned: true }
      for (const url of urls) {
        for (const [key, value] of Object.entries(cleanedOutput)) {
          if (value === url) {
            cleanedOutput[key] = null
          }
        }
      }

      await supabase
        .from("jobs")
        .update({ output_data: cleanedOutput })
        .eq("id", job.id)

      if (jobBytesFreed > 0 && job.user_id) {
        await updateStorageUsage(job.user_id, -jobBytesFreed).catch(() => {})
        bytesFreed += jobBytesFreed
      }
    }

    if (jobs.length < BATCH_SIZE) hasMoreJobs = false
  }

  console.log(`[cleanup] Deleted ${filesDeleted} files for free users (${bytesFreed} bytes freed, ${errors} errors)`)
  return { filesDeleted, bytesFreed, errors }
}

// ============================================================
// B) Clean up media for canceled users (60 days after subscription ended)
// ============================================================

export async function cleanupCanceledUserMedia(): Promise<CleanupResult> {
  let filesDeleted = 0
  let bytesFreed = 0
  let errors = 0

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - MEDIA_RETENTION_DAYS)
  const cutoff = cutoffDate.toISOString()

  // Find users whose grace period has expired
  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("id, tier, subscription_tier")
    .not("subscription_ended_at", "is", null)
    .lt("subscription_ended_at", cutoff)
    .neq("tier", "free")
    .limit(50)

  if (usersError) {
    console.error("[cleanup] Failed to query expired users:", usersError.message)
    return { filesDeleted: 0, bytesFreed: 0, errors: 1 }
  }

  if (!users || users.length === 0) {
    return { filesDeleted: 0, bytesFreed: 0, errors: 0 }
  }

  for (const user of users) {
    let userFilesDeleted = 0
    let userBytesFreed = 0

    // Delete all user's R2 assets
    let hasMore = true
    while (hasMore) {
      const { data: assets } = await supabase
        .from("assets")
        .select("id, r2_key, size_bytes")
        .eq("user_id", user.id)
        .not("r2_key", "is", null)
        .limit(BATCH_SIZE)

      if (!assets || assets.length === 0) {
        hasMore = false
        break
      }

      for (const asset of assets) {
        if (!asset.r2_key) continue
        const deleted = await safeDeleteR2(asset.r2_key)
        if (deleted) {
          userFilesDeleted++
          userBytesFreed += asset.size_bytes ?? 0
          await supabase
            .from("assets")
            .update({ r2_key: null, r2_url: null })
            .eq("id", asset.id)
        } else {
          errors++
        }
      }

      if (assets.length < BATCH_SIZE) hasMore = false
    }

    // Delete all user's job output files
    hasMore = true
    while (hasMore) {
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, output_data")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .not("output_data", "is", null)
        .limit(BATCH_SIZE)

      if (!jobs || jobs.length === 0) {
        hasMore = false
        break
      }

      for (const job of jobs) {
        const output = job.output_data as Record<string, unknown> | null
        if (!output || output._cleaned) continue

        const urls = extractR2UrlsFromOutput(output)
        for (const url of urls) {
          const r2Key = r2KeyFromUrl(url)
          if (!r2Key) continue

          const deleted = await safeDeleteR2(r2Key)
          if (deleted) {
            userFilesDeleted++
          } else {
            errors++
          }
        }

        await supabase
          .from("jobs")
          .update({ output_data: { ...output, _cleaned: true } })
          .eq("id", job.id)
      }

      if (jobs.length < BATCH_SIZE) hasMore = false
    }

    // Downgrade user to free tier and reset storage
    await supabase
      .from("profiles")
      .update({
        tier: FREE_TIER_DEFAULTS.tier,
        subscription_credits: FREE_TIER_DEFAULTS.subscription_credits,
        storage_limit_bytes: FREE_TIER_DEFAULTS.storage_limit_bytes,
        storage_used_bytes: 0,
      })
      .eq("id", user.id)

    filesDeleted += userFilesDeleted
    bytesFreed += userBytesFreed

    console.log(`[cleanup] Cleaned up canceled user ${user.id} -- ${userFilesDeleted} files deleted, downgraded to free`)
  }

  console.log(`[cleanup] Canceled user cleanup: ${filesDeleted} files, ${bytesFreed} bytes freed across ${users.length} users (${errors} errors)`)
  return { filesDeleted, bytesFreed, errors }
}

// ============================================================
// C) Expire subscriptions (safety net for webhook failures)
// ============================================================
//
// The primary downgrade happens in handleSubscriptionCanceled (webhook).
// This cron catches edge cases where the webhook failed or wasn't received.
// It finds "canceled" subscriptions whose paid period has ended and whose
// user profile hasn't been downgraded yet, then downgrades them.

export async function expireSubscriptions(): Promise<ExpiryResult> {
  let usersDowngraded = 0
  let errors = 0

  const now = new Date().toISOString()

  // Find canceled subscriptions whose paid period has ended
  const { data: subs, error: subsError } = await supabase
    .from("subscriptions")
    .select("id, user_id, paddle_subscription_id")
    .eq("status", "canceled")
    .lt("current_period_end", now)
    .limit(100)

  if (subsError) {
    console.error("[cleanup] Failed to query expired subscriptions:", subsError.message)
    return { usersDowngraded: 0, errors: 1 }
  }

  if (!subs || subs.length === 0) {
    return { usersDowngraded: 0, errors: 0 }
  }

  for (const sub of subs) {
    try {
      // Only downgrade if user is still on a paid tier (webhook may have already handled this)
      const { data: profile } = await supabase
        .from("profiles")
        .select("tier")
        .eq("id", sub.user_id)
        .single()

      if (profile && profile.tier !== "free") {
        await supabase
          .from("profiles")
          .update({
            tier: FREE_TIER_DEFAULTS.tier,
            subscription_credits: FREE_TIER_DEFAULTS.subscription_credits,
            storage_limit_bytes: FREE_TIER_DEFAULTS.storage_limit_bytes,
            subscription_ended_at: now,
          })
          .eq("id", sub.user_id)

        usersDowngraded++
      }

      // Mark subscription as "expired" so it's not reprocessed
      await supabase
        .from("subscriptions")
        .update({ status: "expired", updated_at: now })
        .eq("id", sub.id)
    } catch (err) {
      console.error(`[cleanup] Failed to expire subscription ${sub.id}:`, err)
      errors++
    }
  }

  if (usersDowngraded > 0) {
    console.log(`[cleanup] Expired ${usersDowngraded} subscriptions, users downgraded to free (${errors} errors)`)
  }
  return { usersDowngraded, errors }
}

// ============================================================
// D) Send storage warnings (80%, 95%, full)
// ============================================================

export async function sendStorageWarnings(): Promise<WarningResult> {
  let warnings80 = 0
  let warnings95 = 0
  let warningsFull = 0

  // Query users at >80% storage usage
  // Using raw RPC since we need to calculate the ratio
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, storage_used_bytes, storage_limit_bytes, tier, subscription_tier")
    .gt("storage_used_bytes", 0)
    .gt("storage_limit_bytes", 0)
    .limit(500)

  if (error) {
    console.error("[cleanup] Failed to query storage usage:", error.message)
    return { warnings80: 0, warnings95: 0, warningsFull: 0 }
  }

  if (!profiles || profiles.length === 0) {
    return { warnings80: 0, warnings95: 0, warningsFull: 0 }
  }

  for (const profile of profiles) {
    const used = profile.storage_used_bytes ?? 0
    const limit = profile.storage_limit_bytes ?? 0
    if (limit <= 0) continue

    const ratio = used / limit

    if (ratio >= 1.0) {
      // TODO: Replace console.log with actual notification system (email/in-app)
      console.log(`[storage-warning] FULL: User ${profile.id} at ${(ratio * 100).toFixed(1)}% (${formatBytes(used)}/${formatBytes(limit)})`)
      warningsFull++
    } else if (ratio >= 0.95) {
      // TODO: Replace console.log with actual notification system (email/in-app)
      console.log(`[storage-warning] URGENT: User ${profile.id} at ${(ratio * 100).toFixed(1)}% (${formatBytes(used)}/${formatBytes(limit)})`)
      warnings95++
    } else if (ratio >= 0.80) {
      // TODO: Replace console.log with actual notification system (email/in-app)
      console.log(`[storage-warning] WARNING: User ${profile.id} at ${(ratio * 100).toFixed(1)}% (${formatBytes(used)}/${formatBytes(limit)})`)
      warnings80++
    }
  }

  if (warnings80 + warnings95 + warningsFull > 0) {
    console.log(`[cleanup] Storage warnings: ${warnings80} at 80%, ${warnings95} at 95%, ${warningsFull} full`)
  }

  return { warnings80, warnings95, warningsFull }
}

// ============================================================
// Formatting helper
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
