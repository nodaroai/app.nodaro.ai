/**
 * The draft fields only their own routes write (pure). A client's draft save
 * (`PUT /v1/admin/trends/:id/draft`) never sets them: the body's are ignored,
 * and the stored draft's own (at the revision the client read) are kept.
 *
 *   examples      the example routes (copied run media)
 *   faceMask      the face mask routes (approve / clear)
 *   faceMaskJob   the face mask routes (make)
 *   upscaleJobs   the upscale routes
 *   sourceCrop    the crop routes
 *   promptParts   the prompt parts route (checked by the engine first)
 */
import type { TrendVersionData } from "./types.js"

export const SERVER_OWNED_DRAFT_FIELDS = ["examples", "faceMask", "faceMaskJob", "upscaleJobs", "sourceCrop", "promptParts"] as const

/** `edited` (a client's draft body) with every server-owned field taken from `stored`; one `stored` lacks stays absent. */
export function withServerOwnedFields(edited: Record<string, unknown>, stored: TrendVersionData): TrendVersionData {
  const out: Record<string, unknown> = { ...edited }
  for (const field of SERVER_OWNED_DRAFT_FIELDS) {
    delete out[field]
    const own = stored[field]
    if (own !== undefined) out[field] = own
  }
  return out as unknown as TrendVersionData
}
