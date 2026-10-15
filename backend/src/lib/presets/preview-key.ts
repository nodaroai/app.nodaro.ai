import { createHash } from "node:crypto"

/**
 * Where a user preset's own copy of its example picture lives
 * (lib/presets/preview-copy.ts):
 *
 *   node-presets/<userId>/preview-<stamp>.<ext>
 *
 * The stamp is read from the SOURCE key: the CDN keeps every object for a
 * year (immutable), so a new picture must land on a new address, and setting
 * the same picture again — on this preset or another — reuses one copy.
 */
export const PRESET_PREVIEW_PREFIX = "node-presets/"

/** The folder a user's preset pictures sit in. */
export function presetPreviewFolder(userId: string): string {
  return `${PRESET_PREVIEW_PREFIX}${userId.toLowerCase()}/`
}

/** Where the copy of `sourceKey` lives for `userId`. */
export function presetPreviewKey(userId: string, sourceKey: string): string {
  const dot = sourceKey.lastIndexOf(".")
  const ext = dot >= 0 ? sourceKey.slice(dot + 1).toLowerCase() : "png"
  const stamp = createHash("sha256").update(sourceKey).digest("hex").slice(0, 16)
  return `${presetPreviewFolder(userId)}preview-${stamp}.${ext}`
}

/** Whether `key` is one of `userId`'s own preset pictures. */
export function isOwnPresetPreviewKey(userId: string, key: string): boolean {
  return key.startsWith(presetPreviewFolder(userId))
}

/** Whether `key` is any user's preset picture. */
export function isPresetPreviewKey(key: string): boolean {
  return key.startsWith(PRESET_PREVIEW_PREFIX)
}
