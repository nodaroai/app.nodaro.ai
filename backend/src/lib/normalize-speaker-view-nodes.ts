/**
 * The write-boundary guard for Speaker View nodes (SV4 a, pitfall 5b): an agent,
 * an import or a template writes a node straight into workflow JSON, so the
 * config panel's greying and the quick strip's snap never see it. This coerces
 * what the node carries into settings the renderer draws — an unknown id falls
 * back, and a layout the ASPECT rules out snaps to its twin (side by side ↔
 * stacked) — instead of letting it fail at run time, after credits are
 * reserved. It never rejects.
 *
 * Only the aspect can be judged here (no edit is resolved at a write); the
 * speaker count is judged against the real EDL when the run builds its payload
 * (`buildSpeakerViewPayload`), and again in the editor's own run. A node that
 * needs no correction is returned by reference; a corrected one is a fresh
 * object. Never a mutation of the caller's nodes.
 */
import { normalizeSpeakerViewData, type SpeakerViewNodeSettings } from "@nodaro/render-rules"

interface NodeLike {
  id?: unknown
  type?: unknown
  data?: unknown
}

export function normalizeSpeakerViewNodes<T extends NodeLike>(nodes: readonly T[]): T[] {
  return nodes.map((node) => {
    if (node.type !== "speaker-view") return node
    const data = node.data
    if (!data || typeof data !== "object" || Array.isArray(data)) return node
    const normalized = normalizeSpeakerViewData(data as SpeakerViewNodeSettings).data
    return JSON.stringify(normalized) === JSON.stringify(data) ? node : { ...node, data: normalized }
  })
}
