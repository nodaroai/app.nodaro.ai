import {
  LOTTIE_SLOT_FIELD_PREFIX,
  hexToRgbaArray,
  deriveLottieSlotFields,
  flattenItems,
  type PresentationItem,
} from "@nodaro/shared"

/**
 * Collect the node ids that have at least one `{type:"field", field:"slot:…"}`
 * item exposed by a presentation/app's curated input items. These are the nodes
 * for which the creator EXPOSED lottie slot controls — the freeze-on-exposure
 * signal (design F16): such a node's plan must be frozen for app runs (the
 * end-user edits the published animation, the node never re-generates).
 *
 * Items may be nested inside groups, so we flatten first. The `items` param is
 * typed loosely so callers can pass `PresentationItem[]` OR a raw
 * `snapshotSettings.inputItems` array without a cast — only `type`, `nodeId`,
 * and `field` are read.
 */
export function collectSlotExposedNodeIds(
  items: ReadonlyArray<{ type: string; nodeId?: string; field?: string }> | null | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!items) return ids
  // flattenItems unwraps groups; cast through the structural shape (it only
  // recurses on `type === "group"` and reads `.items`, which our loose items
  // carry when they are real PresentationItems).
  const flat = flattenItems(items as PresentationItem[])
  for (const item of flat) {
    if (
      item.type === "field" &&
      typeof item.nodeId === "string" &&
      typeof item.field === "string" &&
      item.field.startsWith(LOTTIE_SLOT_FIELD_PREFIX)
    ) {
      ids.add(item.nodeId)
    }
  }
  return ids
}

/**
 * Fold `slot:<sid>` entries in `inputValues` into a single full-plan `motionPlan`
 * override per node — AND emit a freeze-signal full-plan override for every
 * slot-exposed node, even when the user touched nothing.
 *
 * The orchestrator's inputOverrides merge is SHALLOW (`{ ...node.data,
 * ...overrides }`, design §1 / §Phase 3), so a runtime-editable lottie slot can
 * only be applied by replacing the WHOLE `motionPlan` key with a self-contained
 * plan whose `slotValues` carry the user's edits. This composer does exactly
 * that: for each node carrying `slot:` overrides AND a lottie-graphic plan it
 * emits `{ ...otherNonSlotKeys, motionPlan: { ...snapshotPlan, slotValues } }`.
 *
 * **Freeze-on-exposure (design F16):** when an app/presentation EXPOSES slot
 * fields for a lottie motion-graphics node, that node's plan is FROZEN for app
 * runs. The backend (orchestrator-worker) treats the PRESENCE of a `motionPlan`
 * override on such a node as the freeze signal: it pre-completes the node with
 * the overridden plan instead of re-generating (and re-charging). So we MUST
 * emit the override for EVERY slot-exposed node that has a lottie-graphic plan —
 * even one the user never touched — otherwise an untouched node would re-roll a
 * fresh plan and discard the freeze. Untouched → `slotValues` is just the
 * snapshot plan's existing values (`{ ...snapshotPlan }`), which is still a valid
 * full-plan freeze signal.
 *
 * Non-slot keys (e.g. a text-prompt's `text`) pass through untouched. Nodes
 * without slot overrides and not slot-exposed, and nodes whose plan is not a
 * lottie-graphic, pass through verbatim (their slot-looking keys, if any, are
 * left alone — there is no plan to fold them into). Slot value coercion mirrors
 * `deriveLottieSlotFields`' control kinds: color → hex string to a 0-1 RGBA
 * array; slider → Number; text → verbatim. Pure: never mutates its inputs.
 */
export function composeLottieSlotOverrides(
  inputValues: Record<string, Record<string, unknown>>,
  nodes: ReadonlyArray<{ id: string; type?: string; data?: Record<string, unknown> }>,
  slotExposedNodeIds: ReadonlySet<string> = new Set(),
): Record<string, Record<string, unknown>> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const result: Record<string, Record<string, unknown>> = {}

  // Union of node ids the user touched (inputValues) and slot-exposed node ids.
  // The slot-exposed ids ensure an untouched-but-exposed node still emits its
  // freeze-signal plan override.
  const candidateIds = new Set<string>([
    ...Object.keys(inputValues),
    ...slotExposedNodeIds,
  ])

  for (const nodeId of candidateIds) {
    const values = inputValues[nodeId] ?? {}
    const slotKeys = Object.keys(values).filter((k) => k.startsWith(LOTTIE_SLOT_FIELD_PREFIX))
    const isExposed = slotExposedNodeIds.has(nodeId)

    // No slot keys AND not slot-exposed → passthrough verbatim (copy so we never
    // alias the input). A node only in inputValues with non-slot keys lands here.
    if (slotKeys.length === 0 && !isExposed) {
      result[nodeId] = { ...values }
      continue
    }

    const node = nodeById.get(nodeId)
    const motionPlan = node?.data?.motionPlan as Record<string, unknown> | undefined
    const slotFields = deriveLottieSlotFields(motionPlan)

    // Not a lottie-graphic plan (or node missing) → nothing to fold into / freeze;
    // pass the whole map through verbatim. (For a slot-exposed node this would be
    // an inconsistent published app, but we degrade gracefully rather than inject
    // a bogus motionPlan.)
    if (slotFields.length === 0) {
      result[nodeId] = { ...values }
      continue
    }

    // Index derived control kinds by sid for coercion.
    const kindBySid = new Map<string, "color" | "text" | "slider">(
      slotFields.map((f) => [f.key.slice(LOTTIE_SLOT_FIELD_PREFIX.length), f.type]),
    )

    const existingSlotValues = (motionPlan!.slotValues as Record<string, unknown> | undefined) ?? {}
    const mergedSlotValues: Record<string, unknown> = { ...existingSlotValues }
    const nonSlotKeys: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(LOTTIE_SLOT_FIELD_PREFIX)) {
        nonSlotKeys[key] = value
        continue
      }
      const sid = key.slice(LOTTIE_SLOT_FIELD_PREFIX.length)
      const kind = kindBySid.get(sid)
      // Unknown sid (no matching slot in the plan) → skip; it has nowhere to go.
      if (!kind) continue
      if (kind === "color") {
        mergedSlotValues[sid] = hexToRgbaArray(String(value))
      } else if (kind === "slider") {
        mergedSlotValues[sid] = Number(value)
      } else {
        mergedSlotValues[sid] = value
      }
    }

    result[nodeId] = {
      ...nonSlotKeys,
      motionPlan: { ...motionPlan, slotValues: mergedSlotValues },
    }
  }

  return result
}
