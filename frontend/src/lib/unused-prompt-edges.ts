import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { NODE_PROMPT_CANDIDATE_FIELDS, NODE_MAPPABLE_FIELDS } from "@nodaro/shared"
import { getUpstreamNodes } from "@/lib/node-refs"
import { referencedRefs, hasEmptyInjection } from "@/lib/prompt-ref-scan"
// Canonical identity-source set (character/face/object/location) — reused so a
// new identity type can't drift this detector. Identity sources inject their
// reference/description regardless of any {ref}, so a wire from one is never "unused".
import { IDENTITY_TYPES } from "@/lib/generate-image-handles"

/** Edge IDs wired into a `prompt` handle but NOT used by the consumer's prompt.
 *  Conservative — only flags typed-primary consumers (NODE_PROMPT_CANDIDATE_FIELDS)
 *  with a non-empty typed prompt, no `{}` injection, no `{Label}` ref to the source,
 *  no fieldMapping to the source, and a non-identity source. Mirrors execution-time
 *  precedence so it can't drift. Never flags a live edge. */
export function computeUnusedPromptEdges(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Set<string> {
  const unused = new Set<string>()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // Memoize the per-consumer upstream BFS: several dead prompt edges into the
  // same consumer would otherwise each re-run the full O(V+E) getUpstreamNodes.
  // This detection runs inside the canvas's per-frame animatedEdges memo.
  const upstreamCache = new Map<string, ReturnType<typeof getUpstreamNodes>>()
  const upstreamFor = (consumerId: string) => {
    let u = upstreamCache.get(consumerId)
    if (!u) {
      u = getUpstreamNodes(consumerId, nodes, edges)
      upstreamCache.set(consumerId, u)
    }
    return u
  }

  for (const edge of edges) {
    if (edge.targetHandle !== "prompt") continue
    const consumer = byId.get(edge.target)
    const source = byId.get(edge.source)
    if (!consumer || !source) continue

    const ctype = consumer.type ?? ""
    const promptFields = NODE_PROMPT_CANDIDATE_FIELDS[ctype]
    if (!promptFields) continue // not typed-primary → wire is the source → never unused

    if (IDENTITY_TYPES.has(source.type ?? "")) continue

    const cdata = consumer.data as Record<string, unknown>

    const fm = cdata.fieldMappings as Record<string, unknown> | undefined
    if (
      fm &&
      Object.values(fm).some(
        (v) =>
          v === source.id ||
          (typeof v === "object" &&
            v !== null &&
            (v as { sourceNodeId?: string }).sourceNodeId === source.id),
      )
    )
      continue

    const primary = promptFields
      .map((f) => cdata[f])
      .find((v) => typeof v === "string" && v.trim().length > 0)
    if (!primary) continue

    // Scan the UNION of mappable fields and the typed-primary candidate fields.
    // The primary prompt can live in a candidate field that's absent from
    // NODE_MAPPABLE_FIELDS (e.g. `motionPrompt` for Kling 3 Studio i2v /
    // generate-video / text-to-video, `text` for text-to-audio). Scanning only
    // NODE_MAPPABLE_FIELDS there would miss a {ref}/{} and gray a LIVE edge.
    // Unioning guarantees the scan set is always a superset of the selection set.
    const scanFields = [...new Set([...(NODE_MAPPABLE_FIELDS[ctype] ?? []), ...promptFields])]
    if (hasEmptyInjection(cdata, scanFields)) continue

    const sourceLabel = upstreamFor(consumer.id).find((u) => u.id === source.id)?.label
    if (sourceLabel && referencedRefs(cdata, scanFields).has(sourceLabel)) continue

    unused.add(edge.id)
  }
  return unused
}
