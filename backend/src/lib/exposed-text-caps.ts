/**
 * A published app's exposed TEXT inputs, "<nodeId>:<field>" → the input's
 * character limit, or null when it has none — the `speechTextCaps` the
 * workflow estimate prices an exposed speech text with (lib/speech-estimate.ts
 * :: upstreamSpeechText): a limit caps the ceiling an unknown text is priced
 * at; an exposed field with no limit makes the node's stored text UNKNOWN (it
 * is the author's placeholder, which the app user replaces); an absent key
 * means the field is not exposed and a literal text is priced exactly.
 *
 * Built from the ONE input classifier (`extractAppInputSchema`) — the same
 * pass `get_app_inputs` serves — so a Text node exposed whole (its `text`
 * field, the common published-app shape) and a Text to Speech node's exposed
 * `directText` both reach the estimator's one-hop rule, and a select or a
 * slider never does.
 */
import { extractAppInputSchema } from "./mcp/extract-app-inputs.js"
import type { ExposedTextCaps } from "./speech-estimate.js"

/** A graph node as every estimate surface holds it (an id-less node cannot be an input and is skipped). */
type GraphNode = { id?: string; type?: string; data?: Record<string, unknown> }

export function exposedTextCaps(
  snapshotSettings: Record<string, unknown> | null | undefined,
  snapshotNodes: ReadonlyArray<GraphNode> | null | undefined,
): ExposedTextCaps {
  const withIds = snapshotNodes?.filter((n): n is GraphNode & { id: string } => typeof n.id === "string")
  const { fields, keyMap } = extractAppInputSchema({ snapshotSettings, snapshotNodes: withIds ?? null })
  const caps: Record<string, number | null> = {}
  for (const field of fields) {
    if (field.type !== "text") continue
    const target = keyMap[field.key]
    if (!target) continue
    caps[`${target.nodeId}:${target.fieldKey}`] = typeof field.maxLength === "number" ? field.maxLength : null
  }
  return caps
}

/**
 * The nodes whose MEDIA a published app's user replaces: every exposed image,
 * video or audio input, from the same classifier (`extractAppInputSchema`).
 * With no presentation items that is every upload node, as the runner shows
 * them. The listing prices these with no length (decided 2026-10-07): the
 * creator's sample recording is not the app user's, so a price that follows
 * the recording's length is listed per minute (ee/billing/credits.ts ::
 * listingEstimate). A template's cloner replaces every upload node: the same
 * call with no settings.
 */
export function exposedMediaNodeIds(
  snapshotSettings: Record<string, unknown> | null | undefined,
  snapshotNodes: ReadonlyArray<GraphNode> | null | undefined,
): ReadonlySet<string> {
  const withIds = snapshotNodes?.filter((n): n is GraphNode & { id: string } => typeof n.id === "string")
  const { fields, keyMap } = extractAppInputSchema({ snapshotSettings, snapshotNodes: withIds ?? null })
  const ids = new Set<string>()
  for (const field of fields) {
    if (field.type !== "image" && field.type !== "video" && field.type !== "audio") continue
    const target = keyMap[field.key]
    if (target) ids.add(target.nodeId)
  }
  return ids
}

/**
 * The List nodes of a published app or component that its user fills: every
 * `list` input `extractAppInputSchema` exposes (decided 2026-10-07). The user
 * can enter more items than the creator saved, and each item runs what the
 * List fans out once more, so the listing prices a further item
 * (`AppListingEstimate.previewPerItem`). A template has none: its cloner edits
 * the workflow itself.
 */
export function exposedListNodeIds(
  snapshotSettings: Record<string, unknown> | null | undefined,
  snapshotNodes: ReadonlyArray<GraphNode> | null | undefined,
): ReadonlySet<string> {
  const withIds = snapshotNodes?.filter((n): n is GraphNode & { id: string } => typeof n.id === "string")
  const { fields, keyMap } = extractAppInputSchema({ snapshotSettings, snapshotNodes: withIds ?? null })
  const ids = new Set<string>()
  for (const field of fields) {
    if (field.type !== "list") continue
    const target = keyMap[field.key]
    if (target) ids.add(target.nodeId)
  }
  return ids
}

