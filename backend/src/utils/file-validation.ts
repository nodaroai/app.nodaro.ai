import { supabase } from "../lib/supabase.js"
import { resolveEffectiveTier } from "@nodaro/shared/credits"
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
  /** The CANONICAL type the file was accepted as — `resolveUploadMime`'s
   *  output, which may differ from what the client declared (an alias, or a
   *  generic `application/octet-stream` resolved by filename). Callers must
   *  store and forward THIS, not the declared value. */
  readonly mimeType?: string
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
 * MIME RESOLUTION — what the client DECLARED vs what the file IS.
 *
 * A browser upload carries whatever type the OS handed the file input, and
 * that is not always the canonical spelling in `ALLOWED_MIME_TYPES`:
 *
 *  - **Aliases.** Windows maps `.aac` to `audio/vnd.dlna.adts` (its ADTS
 *    container type), Safari sends `image/jpg`, MediaRecorder sends
 *    `audio/webm;codecs=opus`. All of these are formats we accept and
 *    advertise — rejecting them tells the user their `.aac` file is an
 *    "unsupported file type" while the same message lists `aac` as accepted.
 *  - **Generic.** With no registry entry the platform falls back to
 *    `application/octet-stream`, which says nothing at all. There the
 *    filename EXTENSION is the only signal, so it decides.
 *
 * Resolution is not a security boundary and does not weaken one: the declared
 * type was always client-controlled, and an extension is exactly as forgeable.
 * The bytes are what the downstream processors (sharp, ffprobe) actually read,
 * and the deployment upload policy sees the resolved type plus the buffer.
 *
 * An unknown type resolves to itself, so `validateFile` still rejects it with
 * the honest message.
 */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  // audio
  "audio/vnd.dlna.adts": "audio/aac",   // Windows' type for a plain .aac file
  "audio/aacp": "audio/aac",
  "audio/x-aac": "audio/aac",
  "audio/m4a": "audio/mp4",
  "audio/mp4a-latm": "audio/mp4",
  "audio/x-mp4a-latm": "audio/mp4",
  "audio/mpeg3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-mpeg-3": "audio/mpeg",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-pn-wav": "audio/wav",
  "audio/vorbis": "audio/ogg",
  "audio/x-ogg": "audio/ogg",
  "audio/x-vorbis+ogg": "audio/ogg",
  // video
  "video/x-quicktime": "video/quicktime",
  "video/mov": "video/quicktime",
  "video/avi": "video/x-msvideo",
  "video/msvideo": "video/x-msvideo",
  "video/x-avi": "video/x-msvideo",
  "video/x-m4v": "video/mp4",
  "video/mpeg4": "video/mp4",
  "video/x-matroska-webm": "video/webm",
  // image
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif",
  // data
  "text/json": "application/json",
}

/** Declared types that carry no information — the filename decides instead. */
const UNINFORMATIVE_MIME_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/download",
  "application/force-download",
  "application/unknown",
  "*/*",
])

/** Extension → canonical accepted type. Only extensions we already accept. */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime", qt: "video/quicktime",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav", wave: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac", adts: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg",
  weba: "audio/webm",
  flac: "audio/flac",
  json: "application/json",
}

/** Canonical accepted type for `filename`'s extension, or null. */
function mimeFromFilename(filename?: string | null): string | null {
  if (!filename) return null
  const dot = filename.lastIndexOf(".")
  if (dot < 0 || dot === filename.length - 1) return null
  return EXTENSION_MIME[filename.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * The canonical type an upload should be validated and stored as.
 *
 * Order: strip parameters (`audio/webm;codecs=opus`) → already canonical →
 * known alias → uninformative, so fall back to the filename extension →
 * otherwise return it unchanged so the caller rejects it honestly.
 */
export function resolveUploadMime(
  declaredMime: string | null | undefined,
  filename?: string | null,
): string {
  const declared = (declaredMime ?? "").split(";")[0]!.trim().toLowerCase()
  if (ALL_ALLOWED_TYPES.has(declared)) return declared
  const alias = MIME_ALIASES[declared]
  if (alias) return alias
  if (UNINFORMATIVE_MIME_TYPES.has(declared)) {
    const byExtension = mimeFromFilename(filename)
    if (byExtension) return byExtension
  }
  return declared
}

/** Human category names for the "Accepted types" sentence. */
const CATEGORY_LABELS: Readonly<Record<FileCategory, string>> = {
  image: "images",
  video: "videos",
  audio: "audio",
  data: "data",
}

/**
 * The accepted-types sentence, DERIVED from `ALLOWED_MIME_TYPES` rather than
 * hand-written — the hand-written copy had already drifted (it advertised
 * neither flac, webm audio nor json, all of which the table accepts).
 */
export function acceptedTypesSentence(): string {
  const parts = (Object.keys(ALLOWED_MIME_TYPES) as FileCategory[]).map((category) => {
    const extensions = [
      ...new Set(ALLOWED_MIME_TYPES[category]!.map(getExtensionFromMime)),
    ].filter((ext) => ext !== "bin")
    return `${CATEGORY_LABELS[category]} (${extensions.join(", ")})`
  })
  return `Accepted types: ${parts.join(", ")}`
}

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
  filename?: string | null,
  /** A limit that replaces the category's for this one file (a face-track
   *  file, `lib/speaker-track-upload.ts`). */
  opts: { readonly maxBytes?: number } = {},
): ValidationResult {
  // What the file IS, not only what the client called it — see
  // `resolveUploadMime`. Callers forward `result.mimeType`, never `mimeType`.
  const resolved = resolveUploadMime(mimeType, filename)

  // Check MIME type
  if (!ALL_ALLOWED_TYPES.has(resolved)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}. ${acceptedTypesSentence()}`,
    }
  }

  const category = detectCategory(resolved)
  if (!category) {
    return { valid: false, error: `Could not determine file category for: ${mimeType}` }
  }

  // Check size limit
  const limit = opts.maxBytes ?? getSizeLimit(category)
  if (sizeBytes > limit) {
    return {
      valid: false,
      error: `File too large (${formatBytes(sizeBytes)}). Maximum for ${category}: ${formatBytes(limit)}`,
      category,
      mimeType: resolved,
    }
  }

  return { valid: true, category, mimeType: resolved }
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

  // Deployment payer (item 9): media lives in the deployment's own
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

  // Deployment payer (item 9): TRACK without ENFORCING — the per-user
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
