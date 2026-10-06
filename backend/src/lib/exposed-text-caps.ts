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
