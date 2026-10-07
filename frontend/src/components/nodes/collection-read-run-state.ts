import { normalizeCollectionFields, normalizeCollectionMedia, type CollectionRecord } from "@nodaro/shared"
import type { CollectionReadData } from "@/types/nodes"

/** What the Read Collection card shows, read off the node's data the way the Telegram feed card reads its own. */
export type CollectionReadCardState =
  | { readonly kind: "never-ran" }
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly errorMessage: string }
  | { readonly kind: "empty" }
  | { readonly kind: "success"; readonly count: number }

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/**
 * The last run's records, in the order the node read them (its Order
 * setting), each made whole. A run's records are always complete, but a node
 * written by an agent, an import or a template can hold anything — a record
 * missing its text, a medium that is null — and the card must never throw on
 * it (a throw takes the whole canvas down).
 */
export function collectionReadRecords(json: unknown): CollectionRecord[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((v): CollectionRecord[] => {
    if (!isPlainObject(v) || typeof v.id !== "string" || !v.id) return []
    return [
      {
        id: v.id,
        collectionId: str(v.collectionId),
        title: str(v.title),
        text: str(v.text),
        url: typeof v.url === "string" ? v.url : null,
        media: normalizeCollectionMedia(v.media),
        fields: normalizeCollectionFields(v.fields),
        dedupeKey: typeof v.dedupeKey === "string" ? v.dedupeKey : null,
        source: isPlainObject(v.source) ? (v.source as CollectionRecord["source"]) : {},
        createdAt: str(v.createdAt),
      },
    ]
  })
}

export function deriveCollectionReadCardState(d: CollectionReadData): CollectionReadCardState {
  if (d.executionStatus === "running") return { kind: "running" }
  if (d.executionStatus === "failed") return { kind: "failed", errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : "" }
  if (d.generatedJson === undefined && d.generatedText === undefined) return { kind: "never-ran" }
  const count = collectionReadRecords(d.generatedJson).length
  return count > 0 ? { kind: "success", count } : { kind: "empty" }
}
