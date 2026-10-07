/**
 * Apply presentation / published-app input overrides onto source node data.
 *
 * The orchestrator merge is SHALLOW: per node, `{ ...node.data, ...overrides }`.
 * A top-level override key REPLACES the snapshot's value for that key wholesale
 * — there is no deep merge. This is what makes the lottie full-plan override work
 * by construction: the app runtime sends `inputOverrides[nodeId].motionPlan =
 * { ...snapshotPlan, slotValues }`, and the shallow merge swaps the whole stale
 * `motionPlan` for the self-contained one (design §1 / §Phase 3).
 *
 * Extracted from `orchestrator-worker.ts` so the merge semantics are pinned by a
 * focused unit test (the orchestrator calls THIS function — single source of
 * truth, no copied logic to drift).
 */

import { locationMentionSlug, mergeNodeInputOverrides, RUN_OVERRIDE_CLEARED_FIELDS } from "@nodaro/shared"
import { assertNoLockedOverrides } from "../lib/input-override-lock.js"
import { coerceListItemsOverrideToRows } from "../services/workflow-engine/output-extractor.js"
import { LOCATION_VARIANT_BUCKETS } from "../services/workflow-engine/payload-builder.js"

/**
 * When `data.selectedVariant` is set (e.g. `"weather/rain"` from an app-input
 * override), patch `data.sourceImageUrl` to the matching variant's URL so all
 * downstream consumers (output-extractor, expandWiredLocationRefs canonical
 * entry, frontend mirror) treat the variant as the canonical image for this run.
 * Match uses `locationMentionSlug` on both sides so publisher-stored `"Light
 * Rain"` (slug `light-rain`) matches an override of `"weather/light-rain"`.
 * Mutates `data` in place; no-op on malformed input or unknown variant.
 */
export function applyLocationVariantOverride(data: Record<string, unknown>): void {
  const spec = typeof data.selectedVariant === "string" ? data.selectedVariant.trim() : ""
  const slashAt = spec.indexOf("/")
  if (slashAt <= 0) return
  const bucket = spec.slice(0, slashAt)
  if (!(LOCATION_VARIANT_BUCKETS as readonly string[]).includes(bucket)) return
  const target = locationMentionSlug(spec.slice(slashAt + 1))
  if (!target) return
  const items = data[bucket]
  if (!Array.isArray(items)) return
  for (const it of items) {
    const name = (it as { name?: unknown } | null)?.name
    if (typeof name !== "string") continue
    if (locationMentionSlug(name) !== target) continue
    const url = (it as { url?: unknown }).url
    if (typeof url === "string" && url) data.sourceImageUrl = url
    return
  }
}

/** Node shape the orchestrator merge needs (matches SimpleNode's relevant fields). */
interface OverridableNode {
  id: string
  type?: string
  data: Record<string, unknown>
}

/**
 * Apply `inputOverrides` onto each node's `data` IN PLACE (mutates `node.data`,
 * mirroring the orchestrator's existing behavior on its loaded graph).
 *
 * For every node with an override map: shallow-merge over `node.data`, then clear
 * stale generated* results from the snapshot so the user's fresh input wins over
 * a cached result, apply location-variant + list-items coercions, and write back.
 *
 * Refuses FIRST, before touching any node: an override may not re-point an
 * outbound node (issue #1555 — `lib/input-override-lock.ts`). This is the one
 * merge every run lane shares, so the lock here covers an entry point that
 * forgot its own 400; the throw leaves the graph untouched and the
 * orchestrator's outer catch fails the execution with the message.
 */
export function applyInputOverridesToNodes(
  nodes: OverridableNode[],
  inputOverrides: Record<string, Record<string, unknown>> | undefined,
): void {
  if (!inputOverrides) return
  assertNoLockedOverrides(nodes, inputOverrides)
  for (const node of nodes) {
    const overrides = inputOverrides[node.id]
    if (!overrides) continue
    // The shared merge — NOT a bare spread: it also drops the snapshot's
    // media-bound `metadata` when the override swaps the node's media, so a
    // publisher's recorded length can't describe a caller's different file.
    const cleaned = mergeNodeInputOverrides(node.type, node.data, overrides)
    // The same fields `withRunOverrides` (@nodaro/shared) clears, so the
    // editor's view of a run with overrides is the run the server executes.
    for (const key of RUN_OVERRIDE_CLEARED_FIELDS) delete cleaned[key]
    if (node.type === "location") {
      applyLocationVariantOverride(cleaned)
    }
    // A columns-present `list` (incl. migrated former-`loop`) used as a
    // published-app input gets the user's value as an `items: string[]` override
    // (ListInputCard always writes `items`). Both list extractors read `rows`
    // first when `columns` exist, so without this the override is ignored and the
    // run uses the STALE snapshot rows. Rewrite rows from the items override so
    // the user's input is authoritative.
    coerceListItemsOverrideToRows(cleaned)
    node.data = cleaned
  }
}
