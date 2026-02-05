import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"

// ============================================================
// MIME Type Validation
// ============================================================

const ALLOWED_MIME_TYPES: Record<string, ReadonlyArray<string>> = {
  image: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
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
// Storage Quotas per Tier (in bytes)
// ============================================================

const STORAGE_QUOTAS: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,          // 1 GB
  basic: 10 * 1024 * 1024 * 1024,         // 10 GB
  standard: 25 * 1024 * 1024 * 1024,      // 25 GB
  pro: 50 * 1024 * 1024 * 1024,           // 50 GB
  business: 200 * 1024 * 1024 * 1024,     // 200 GB
  enterprise: 500 * 1024 * 1024 * 1024,   // 500 GB
}

// ============================================================
// Types
// ============================================================

export type FileCategory = "image" | "video" | "audio"

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
      error: `Unsupported file type: ${mimeType}. Accepted types: images (png, jpg, webp, gif), videos (mp4, webm, mov, avi), audio (mp3, wav, m4a, aac, ogg)`,
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
  if (config.EDITION === "self-hosted") {
    return { allowed: true }
  }

  // Get user profile for tier and current storage usage
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("storage_used_bytes, subscription_tier")
    .eq("id", userId)
    .single()

  if (error || !profile) {
    return {
      allowed: false,
      error: "Could not verify storage quota: user profile not found",
    }
  }

  const tier = profile.subscription_tier ?? "free"
  const usedBytes = profile.storage_used_bytes ?? 0
  const quotaBytes = STORAGE_QUOTAS[tier] ?? STORAGE_QUOTAS.free

  const newUsed = usedBytes + fileSizeBytes
  if (newUsed > quotaBytes) {
    return {
      allowed: false,
      error: `Storage quota exceeded. Used: ${formatBytes(usedBytes)}, Quota: ${formatBytes(quotaBytes)}, File: ${formatBytes(fileSizeBytes)}`,
      usedBytes,
      quotaBytes,
      remainingBytes: Math.max(0, quotaBytes - usedBytes),
    }
  }

  return {
    allowed: true,
    usedBytes,
    quotaBytes,
    remainingBytes: quotaBytes - newUsed,
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
  if (config.EDITION === "self-hosted") return

  const { data: profile } = await supabase
    .from("profiles")
    .select("storage_used_bytes")
    .eq("id", userId)
    .single()

  if (!profile) return

  const currentUsed = profile.storage_used_bytes ?? 0

  await supabase
    .from("profiles")
    .update({ storage_used_bytes: currentUsed + additionalBytes })
    .eq("id", userId)
}
