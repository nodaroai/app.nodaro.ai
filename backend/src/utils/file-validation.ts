import { supabase } from "../lib/supabase.js"
import { resolveEffectiveTier } from "@nodaro/shared"
import { hasCredits } from "../lib/config.js"
import { deploymentPayerActive } from "../lib/deployment-payer.js"
import { TIER_STORAGE_LIMITS } from "../ee/billing/stripe-config.js"

// ============================================================
// MIME Type Validation
// ============================================================

const ALLOWED_MIME_TYPES: Record<string, ReadonlyArray<string>> = {
  image: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
  ],
  video: [
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-msvideo",
  ],
  audio: [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
    "audio/x-flac",
  ],
  data: [
    "application/json",
  ],
}

const ALL_ALLOWED_TYPES = new Set(
  Object.values(ALLOWED_MIME_TYPES).flat()
)

// ============================================================
// Size Limits (in bytes)
// ============================================================

const SIZE_LIMITS: Record<string, number> = {
  image: 25 * 1024 * 1024,   // 25 MB
  video: 500 * 1024 * 1024,  // 500 MB
  audio: 50 * 1024 * 1024,   // 50 MB
}

const DEFAULT_SIZE_LIMIT = 50 * 1024 * 1024 // 50 MB fallback

// ============================================================
// Types
// ============================================================

export type FileCategory = "image" | "video" | "audio" | "data"

export interface ValidationResult {
  readonly valid: boolean
  readonly error?: string
  readonly category?: FileCategory
}

export interface StorageQuotaResult {
  readonly allowed: boolean
  readonly error?: string
  readonly usedBytes?: number
  readonly quotaBytes?: number
  readonly remainingBytes?: number
  readonly tier?: string
}

// ============================================================
// Helpers
// ============================================================

/**
 * Detect file category from MIME type
 */
export function detectCategory(mimeType: string): FileCategory | null {
  for (const [category, types] of Object.entries(ALLOWED_MIME_TYPES)) {
    if (types.includes(mimeType)) {
      return category as FileCategory
    }
  }
  return null
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "weba",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "application/json": "json",
  }
  return map[mimeType] ?? "bin"
}

/**
 * Get size limit for a given category
 */
export function getSizeLimit(category: FileCategory): number {
  return SIZE_LIMITS[category] ?? DEFAULT_SIZE_LIMIT
}

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// ============================================================
// Validation Functions
// ============================================================

/**
 * Validate file MIME type and size
 */
export function validateFile(
  mimeType: string,
  sizeBytes: number,
): ValidationResult {
  // Check MIME type
  if (!ALL_ALLOWED_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}. Accepted types: images (png, jpg, webp, gif, avif, heic, heif), videos (mp4, webm, mov, avi), audio (mp3, wav, m4a, aac, ogg)`,
    }
  }

  const category = detectCategory(mimeType)
  if (!category) {
    return { valid: false, error: `Could not determine file category for: ${mimeType}` }
  }

  // Check size limit
  const limit = getSizeLimit(category)
  if (sizeBytes > limit) {
    return {
      valid: false,
      error: `File too large (${formatBytes(sizeBytes)}). Maximum for ${category}: ${formatBytes(limit)}`,
      category,
    }
  }

  return { valid: true, category }
}

/**
 * Check user's storage quota (cloud edition only)
 * Self-hosted: always allows
 */
export async function checkStorageQuota(
  userId: string,
  fileSizeBytes: number,
): Promise<StorageQuotaResult> {
  // Self-hosted: no quota enforcement
  if (!hasCredits()) {
    return { allowed: true }
  }

  // Deployment payer (SAI item 9): media lives in the deployment's own
  // bucket — their space, their business. No per-user ceiling; per-user
  // LIMITS, if the deployment wants them, belong in their overlay hooks.
  if (deploymentPayerActive()) {
    return { allowed: true }
  }

  // Get user profile for tier, current storage usage, and admin-overridable limit
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("storage_used_bytes, storage_limit_bytes, tier, subscription_tier, lifetime_topup_credits")
    .eq("id", userId)
    .single()

  if (error || !profile) {
    return {
      allowed: false,
      error: "Could not verify storage quota: user profile not found",
    }
  }

  // Effective tier: payg users get the 10 GB basic-equivalent quota fallback.
  const tier = resolveEffectiveTier({
    tier: (profile.tier as string | null) ?? null,
    subscription_tier: (profile.subscription_tier as string | null) ?? null,
    lifetime_topup_credits: (profile.lifetime_topup_credits as number) ?? 0,
  })
  const usedBytes = profile.storage_used_bytes ?? 0
  const dbLimit = profile.storage_limit_bytes ?? 0
  const tierLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free
  // Use tier-based limit when DB has no value or the stale 500MB default (524288000)
  const quotaBytes = dbLimit > 0 && dbLimit !== 524288000 ? dbLimit : tierLimit

  const newUsed = usedBytes + fileSizeBytes
  if (newUsed > quotaBytes) {
    return {
      allowed: false,
      error: `Storage quota exceeded. Used: ${formatBytes(usedBytes)}, Quota: ${formatBytes(quotaBytes)}, File: ${formatBytes(fileSizeBytes)}`,
      usedBytes,
      quotaBytes,
      remainingBytes: Math.max(0, quotaBytes - usedBytes),
      tier,
    }
  }

  return {
    allowed: true,
    usedBytes,
    quotaBytes,
    remainingBytes: quotaBytes - newUsed,
    tier,
  }
}

/**
 * Update user's storage usage after upload
 */
export async function updateStorageUsage(
  userId: string,
  additionalBytes: number,
): Promise<void> {
  // Self-hosted: no tracking
  if (!hasCredits()) return

  const { error } = await supabase.rpc("increment_storage", {
    p_user_id: userId,
    p_bytes: additionalBytes,
  })

  if (error) {
    console.error("[updateStorageUsage] increment_storage RPC failed:", error.message)
  }
}

/**
 * Atomically reserve storage quota before an upload starts. Takes a row-level
 * lock on profiles and commits the increment only if the resulting usage stays
 * within the tier-resolved quota. This closes the concurrent-upload
 * oversubscription window that per-request snapshots leave open.
 *
 * Returns true on successful reservation. On self-hosted (`hasCredits()` false)
 * returns true without touching the DB, matching updateStorageUsage semantics.
 */
export async function reserveStorageIfWithinLimit(
  userId: string,
  bytes: number,
): Promise<boolean> {
  if (!hasCredits()) return true
  if (bytes <= 0) return true

  // Deployment payer (SAI item 9): TRACK without ENFORCING — the per-user
  // counter keeps meaning something (the deployment can read it for its own
  // limits), but no requester is ever refused for space in a bucket the
  // deployment owns. refundStorage stays the exact inverse.
  if (deploymentPayerActive()) {
    await updateStorageUsage(userId, bytes)
    return true
  }

  const { data, error } = await supabase.rpc("reserve_storage_if_within_limit", {
    p_user_id: userId,
    p_bytes: bytes,
  })

  if (error) {
    console.error(
      "[reserveStorageIfWithinLimit] RPC failed:",
      error.message,
    )
    return false
  }

  return data === true
}

/**
 * Refund previously reserved storage bytes. Pairs with
 * reserveStorageIfWithinLimit after an upload either finishes smaller than
 * the reservation or fails entirely. Non-positive inputs and self-hosted
 * deployments are no-ops.
 */
export async function refundStorage(
  userId: string,
  bytes: number,
): Promise<void> {
  if (!hasCredits()) return
  if (bytes <= 0) return

  const { error } = await supabase.rpc("decrement_storage", {
    p_user_id: userId,
    p_bytes: bytes,
  })

  if (error) {
    console.error("[refundStorage] decrement_storage RPC failed:", error.message)
  }
}

/**
 * Account previously un-reserved storage bytes against a user. The increment
 * counterpart to {@link refundStorage} — used when bytes are committed to a
 * user's quota outside the reserve/refund path (e.g. a community listing copy
 * the publisher owns). Non-positive inputs and self-hosted deployments are
 * no-ops, matching refundStorage semantics.
 */
export async function accountStorage(
  userId: string,
  bytes: number,
): Promise<void> {
  if (!hasCredits()) return
  if (bytes <= 0) return

  const { error } = await supabase.rpc("increment_storage", {
    p_user_id: userId,
    p_bytes: bytes,
  })

  if (error) {
    console.error("[accountStorage] increment_storage RPC failed:", error.message)
  }
}
