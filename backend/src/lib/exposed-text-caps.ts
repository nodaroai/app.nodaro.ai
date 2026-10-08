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
 * slider never does — with one exception: an exposed output budget of an LLM
 * node (its `maxTokens` slider, and its model, effort and advanced-mode inputs),
 * keyed the same way (a slider's largest value, else null), because the app user
 * can raise what a script written by that node may reach (`llmScriptChars`).
 */
import { extractAppInputSchema } from "./mcp/extract-app-inputs.js"
import { LLM_TEXT_NODE_TYPES } from "./llm-node-output-cap.js"
import { LLM_CAP_FIELDS, type ExposedTextCaps } from "./speech-estimate.js"

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
    const target = keyMap[field.key]
    if (!target) continue
    if (field.type !== "text") {
      // An LLM node's output budget (the token cap a generated voice's script is bounded by):
      // presence is the signal, a slider's largest value is the value (null = no known ceiling).
      const node = withIds?.find((n) => n.id === target.nodeId)
      if (node?.type && LLM_TEXT_NODE_TYPES.has(node.type) && (target.fieldKey === "maxTokens" || (LLM_CAP_FIELDS as readonly string[]).includes(target.fieldKey))) {
        caps[`${target.nodeId}:${target.fieldKey}`] = target.fieldKey === "maxTokens" && typeof field.max === "number" ? field.max : null
      }
      continue
    }
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
  // A Video URL (YouTube or any link) is replaced like a recording (decided
  // 2026-10-07): its link is the one thing a cloner changes, and an app that
  // exposes the link hands it to the user. The input classifier types it as
  // text, so it is found by its node type and its link field.
  const typeOf = new Map((withIds ?? []).map((n) => [n.id, n.type]))
  if (!snapshotSettings) for (const n of withIds ?? []) if (n.type === VIDEO_URL_NODE_TYPE) ids.add(n.id)
  for (const field of fields) {
    const target = keyMap[field.key]
    if (target && typeOf.get(target.nodeId) === VIDEO_URL_NODE_TYPE && VIDEO_URL_LINK_FIELDS.has(target.fieldKey)) ids.add(target.nodeId)
  }
  return ids
}

/** The Video URL node (UI label "Video URL"; the type id stays `youtube-video`). */
const VIDEO_URL_NODE_TYPE = "youtube-video"
/** What an exposed Video URL writes: its link (`youtubeUrl`), or `value`, where the input classifier puts a node exposed whole. */
const VIDEO_URL_LINK_FIELDS: ReadonlySet<string> = new Set(["youtubeUrl", "value"])

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


/**
 * The Video URL nodes a published app exposes as an input: the only ones a run
 * request may point at a new link (lib/input-override-lock.ts ::
 * VideoLinkAdmission). Same classifier as the rest of this file, so "exposed"
 * means what the app's runner and `get_app_inputs` mean by it — including the
 * no-presentation-settings case, where every source node is an input.
 */
export function exposedVideoLinkNodeIds(
  snapshotSettings: Record<string, unknown> | null | undefined,
  snapshotNodes: ReadonlyArray<GraphNode> | null | undefined,
): ReadonlySet<string> {
  const withIds = snapshotNodes?.filter((n): n is GraphNode & { id: string } => typeof n.id === "string")
  const videoLinkIds = new Set(withIds?.filter((n) => n.type === "youtube-video").map((n) => n.id))
  const ids = new Set<string>()
  if (videoLinkIds.size === 0) return ids
  const { keyMap } = extractAppInputSchema({ snapshotSettings, snapshotNodes: withIds ?? null })
  for (const target of Object.values(keyMap)) if (videoLinkIds.has(target.nodeId)) ids.add(target.nodeId)
  return ids
}
