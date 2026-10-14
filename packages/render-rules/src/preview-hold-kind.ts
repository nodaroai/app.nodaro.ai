/**
 * What kind of node holds a run for a review — the one rule every preview
 * refusal picks its remedy by, on both engines. A render at Preview is fixed
 * by setting it to Final; a use-case node with review on is fixed by turning
 * its "Review before render" off (a Final quality does nothing to it).
 *
 *   - "review": every holder is a use-case node with review on;
 *   - "any":    both kinds actually hold the run;
 *   - "render": otherwise — renders at Preview, and whatever is not known
 *     (no holder named, an older refusal that recorded no kind): the wording
 *     render users have always seen.
 */
import {
  PREVIEW_RENDER_NESTED,
  PREVIEW_RENDER_NESTED_MIXED,
  PREVIEW_RENDER_NESTED_REVIEW_ON,
  PREVIEW_RENDER_NODE_TYPES,
  PREVIEW_REVIEW_REQUIRED,
  PREVIEW_REVIEW_REQUIRED_MIXED,
  PREVIEW_REVIEW_REQUIRED_REVIEW_ON,
  REVIEW_HOLDING_USE_CASE_TYPES,
} from "@nodaro/shared/nodes"

export type PreviewHoldKind = "render" | "review" | "any"

/** The kind of the holding nodes' types. */
export function previewHoldKind(types: Iterable<string | null | undefined>): PreviewHoldKind {
  let render = false
  let review = false
  for (const type of types) {
    if (REVIEW_HOLDING_USE_CASE_TYPES.has(type ?? "")) review = true
    else if (PREVIEW_RENDER_NODE_TYPES.has(type ?? "")) render = true
  }
  if (review && render) return "any"
  return review ? "review" : "render"
}

/** The kind of the holding nodes `ids` of a graph (the stop rule's previewRenderIds / savedPreviewRenderIds). */
export function previewHoldKindOf(
  ids: Iterable<string>,
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string | null }>,
): PreviewHoldKind {
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]))
  return previewHoldKind([...ids].map((id) => typeOf.get(id)))
}

/** Which preview refusal: nobody is there to review the run, or a nested graph holds it. */
export type PreviewRefusalFamily = "headless" | "nested"

/**
 * The stable code a refusal is recorded with, by what held the run — the
 * kind rides the code itself (an execution row stores only the code). A
 * render-held refusal keeps the code it has always had.
 */
const CODES: Readonly<Record<PreviewRefusalFamily, Readonly<Record<PreviewHoldKind, string>>>> = {
  headless: { render: PREVIEW_REVIEW_REQUIRED, review: PREVIEW_REVIEW_REQUIRED_REVIEW_ON, any: PREVIEW_REVIEW_REQUIRED_MIXED },
  nested: { render: PREVIEW_RENDER_NESTED, review: PREVIEW_RENDER_NESTED_REVIEW_ON, any: PREVIEW_RENDER_NESTED_MIXED },
}

/** The code a `family` refusal held by `kind` is recorded with. */
export function previewRefusalCode(family: PreviewRefusalFamily, kind: PreviewHoldKind): string {
  return CODES[family][kind]
}

/** What a recorded preview refusal code says: its family and the kind that held the run (undefined for any other code). */
export function previewRefusalOfCode(code: unknown): { readonly family: PreviewRefusalFamily; readonly kind: PreviewHoldKind } | undefined {
  for (const family of ["headless", "nested"] as const) {
    for (const kind of ["render", "review", "any"] as const) if (CODES[family][kind] === code) return { family, kind }
  }
  return undefined
}
