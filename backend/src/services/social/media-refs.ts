import { r2KeyFromOurUrl, r2Url } from "../../lib/storage.js"
import type { MediaItem } from "./platforms/index.js"

/**
 * Scheduled-post media are stored as STABLE ASSET REFS (R2 keys), never raw
 * URLs: a presigned/raw URL persisted at schedule time can expire before a
 * far-future `scheduled_at`, and the failure would surface in the worker after
 * the user walked away. Refs are resolved to fresh public URLs at publish time.
 */

export interface ScheduledMediaRef {
  type: "photo" | "video"
  r2Key: string
}

export interface ScheduledMediaInput {
  type: "photo" | "video"
  r2Key?: string
  url?: string
}

export class MediaRefError extends Error {}

/**
 * Normalize creation input to refs. Accepts either an explicit `r2Key` or a
 * URL that points at OUR R2 public host (converted to its key). Foreign URLs
 * are rejected — we cannot guarantee they outlive the schedule.
 */
export function normalizeMediaInput(items: ScheduledMediaInput[]): ScheduledMediaRef[] {
  return items.map((item, i) => {
    if (item.r2Key) {
      if (item.r2Key.includes("..") || item.r2Key.startsWith("/")) {
        throw new MediaRefError(`media[${i}]: invalid r2Key`)
      }
      return { type: item.type, r2Key: item.r2Key }
    }
    if (item.url) {
      const key = r2KeyFromOurUrl(item.url)
      if (!key) {
        throw new MediaRefError(
          `media[${i}]: only assets hosted on this deployment can be scheduled — upload the file first (got a foreign URL)`,
        )
      }
      return { type: item.type, r2Key: key }
    }
    throw new MediaRefError(`media[${i}]: provide r2Key or url`)
  })
}

/** Resolve stored refs to fresh public URLs for the publish call. */
export function resolveMediaRefs(refs: ScheduledMediaRef[]): MediaItem[] {
  return refs.map((ref) => ({ type: ref.type, url: r2Url(ref.r2Key) }))
}
