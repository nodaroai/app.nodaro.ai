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
 *  Preset meta:
 *  - `__activePresetId`: which preset is currently loaded onto the node (for the dropdown's
 *    active-name + dirty `*`). Node-local UI state, never part of a preset's own config.
 *
 *  NOTE: manual reference image urls (`referenceImageUrl` / `referenceImageUrls`) are deliberately
 *  KEPT — they are self-contained R2 urls a user set as input, and portable across nodes.
 */
export const PRESET_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "label",
  "fieldMappings",
  "__activePresetId",
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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object)
    const kb = Object.keys(b as object)
    if (ka.length !== kb.length) return false
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  }
  return false
}

/**
 * True iff the node's `data` still matches the preset — i.e. every key the preset defines
 * deep-equals the node's current value. Compares only preset-defined keys (the node may carry
 * extra keys the preset doesn't set, e.g. seed, which must NOT count as a mismatch). Used to drive
 * the dropdown's dirty `*` indicator.
 */
export function presetDataMatches(
  nodeData: Readonly<Record<string, unknown>>,
  presetData: Readonly<Record<string, unknown>>,
): boolean {
  for (const key of Object.keys(presetData)) {
    if (!deepEqual(nodeData[key], presetData[key])) return false
  }
  return true
}
