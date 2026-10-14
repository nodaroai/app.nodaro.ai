// Turn a picker node's stored values into the labels the pickers show.
//
// The nodes store catalog SLUGS (`eyes-green`, `white-seamless`). Reading them
// through the same catalogs the pickers use means the tutorial always shows the
// wording the product shows, and a renamed option follows automatically —
// whereas a hand-written list would quietly start lying.

import {
  getPersonLabel,
} from "@nodaro/prompts/person"
import {
  getBackdropLabel,
  getFramingLabel,
  getMoodLabel,
} from "@nodaro/prompts/pickers"
import type { WorkflowNode } from "@/types/nodes"

/** Fields that are node plumbing rather than a user's pick. */
const NOT_A_PICK = new Set([
  "label",
  "type",
  "displayMode",
  "maxItemsPerRow",
  "fieldMappings",
  "generatedResults",
  "activeResultIndex",
  "executionStatus",
])

/** Last-resort prettifier for a value with no catalog entry — derived from the
 *  value itself, so it can be wrong-looking but never wrong. */
function prettify(value: string): string {
  const words = value.replace(/[-_]/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function labelFor(nodeType: string | undefined, value: string): string {
  switch (nodeType) {
    case "person":
      return getPersonLabel(value, prettify(value))
    case "backdrop":
      return getBackdropLabel(value, prettify(value))
    case "framing":
      return getFramingLabel(value, prettify(value))
    case "mood":
      return getMoodLabel(value, prettify(value))
    default:
      return prettify(value)
  }
}

/**
 * Every pick on a picker node, in the order the node stores them, as display
 * labels. Array-valued fields (a person can carry several ethnicities) expand
 * into one label each, which is what the picker shows too.
 */
export function nodePicks(node: WorkflowNode | undefined): string[] {
  if (!node) return []
  const data = (node.data ?? {}) as Record<string, unknown>
  const picks: string[] = []
  for (const [field, value] of Object.entries(data)) {
    if (NOT_A_PICK.has(field)) continue
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v !== "string" || !v.trim()) continue
      picks.push(labelFor(node.type, v))
    }
  }
  return picks
}
