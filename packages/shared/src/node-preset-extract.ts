import { EXECUTION_DATA_KEYS } from "./node-runtime-keys.js"

/**
 * Config fields that are intentionally NOT part of a preset, because they are not portable
 * configuration — they identify the node on the canvas, wire it into one specific graph, or point
 * at specific DB entities. Capturing them would make a preset silently wrong when applied to a
 * different node or workflow. This is the single place that defines that contract, so the system
 * stays correct-by-construction as new node types are added.
 *
 *  Identity:
 *  - `label`: the node's canvas identity. Presets carry their own name and must not rename the node.
 *
 *  Graph wiring (reference specific upstream node / handle / tile ids — meaningless elsewhere):
 *  - `fieldMappings`: field -> upstream node id.
 *  - `referenceImageOrder` / `referenceOrder` / `connectedMediaOrder` / `connectedRefImageOrder`:
 *    orderings keyed by the ids of wired upstream references.
 *
 *  Structural identifiers (handle / port / route / channel ids that must stay unique per node and
 *  that downstream edges target — copying them across nodes orphans edges or duplicates a channel):
 *  - `routes` / `routeId` / `routeIds`: router routes + sub-workflow/condition route pairing ids.
 *  - `ports` / `inputPorts` / `outputPorts`: sub-workflow port arrays (each port has a handle id).
 *  - `channel` / `channelColor`: teleport send/receive pairing channel (auto-assigned per node).
 *
 *  DB entity references / per-wiring identity state (tied to specific characters/locations):
 *  - `characterDefinitionIds`, `suppressedCanonicalCharacterIds`, `suppressedCanonicalLocationIds`.
 *  - `identityMeta`: per-identity overrides keyed by the wired identity's index/label.
 *  - `extraRefs`: extra references carrying `characterSlug` + workflow-specific asset urls.
 *
 *  NOTE: manual reference image urls (`referenceImageUrl` / `referenceImageUrls`) are deliberately
 *  KEPT — they are self-contained R2 urls a user set as input, and portable across nodes.
 */
export const PRESET_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "label",
  "fieldMappings",
  "referenceImageOrder",
  "referenceOrder",
  "connectedMediaOrder",
  "connectedRefImageOrder",
  "characterDefinitionIds",
  "suppressedCanonicalCharacterIds",
  "suppressedCanonicalLocationIds",
  "identityMeta",
  "extraRefs",
  // structural identifiers
  "routes",
  "routeId",
  "routeIds",
  "ports",
  "inputPorts",
  "outputPorts",
  "channel",
  "channelColor",
])

/**
 * Capture a node's reusable configuration from its `data`: a shallow copy minus runtime/result
 * state (EXECUTION_DATA_KEYS) and graph/identity fields (PRESET_EXCLUDED_KEYS). Pure; never mutates
 * the input. Node-type-agnostic — the node type is stored alongside the result by the caller.
 */
export function extractPresetData(
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (EXECUTION_DATA_KEYS.has(key)) continue
    if (PRESET_EXCLUDED_KEYS.has(key)) continue
    out[key] = data[key]
  }
  return out
}
