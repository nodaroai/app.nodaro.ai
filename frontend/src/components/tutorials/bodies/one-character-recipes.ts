// Read the "One Character, Any Scene" shape off its snapshot.
//
// The template is a fan-out over recipes:
//   two SOURCE images (one generated, one uploaded)
//     → five RECIPE nodes, each a Generate Image whose prompt names PARTS of
//       those sources — `{image:1:person} with {image:2:face}` — and each
//       wired to the SAME two sources on its References handle.
// Nothing here is keyed on a node id or a label. A recipe is found by shape
// (an image node whose prompt carries a qualified `{image:N:part}` token and
// whose References are wired), its sources by walking those edges IN ORDER —
// the N in `{image:N}` is a position in that list, which is the whole lesson —
// and the authored prose in one-character-content.ts is matched to a recipe by
// its TOKEN SIGNATURE — which parts of which numbers it names — the one thing
// that is the recipe (the prose between the tokens may be re-worded, and the
// live prompt of recipe 5 has a stray capital and a missing space).

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { deriveReferences, nodeMedia } from "../derive-tutorial-data"

type NodeData = Record<string, unknown>

/** One piece of a prompt: plain text, or an `{image:N[:qualifier]}` token. */
export interface PromptPart {
  readonly text: string
  /** Position of the source the token names (1-based); null for plain text. */
  readonly n: number | null
  /** The part the token borrows ("person", "face", …); null for a bare token / plain text. */
  readonly qualifier: string | null
}

/**
 * Split a prompt into plain runs and image tokens, qualified or bare. Joining
 * the parts' text reproduces the prompt exactly. Qualifiers are letters,
 * digits, `_` and `-` (HeyGen-style role words: `person`, `face`, `settings`).
 */
export function parseImageTokens(prompt: string): PromptPart[] {
  return prompt
    .split(/(\{image:\d+(?::[A-Za-z0-9_-]+)?\})/)
    .filter((part) => part !== "")
    .map((part) => {
      const m = /^\{image:(\d+)(?::([A-Za-z0-9_-]+))?\}$/.exec(part)
      return { text: part, n: m ? Number(m[1]) : null, qualifier: m?.[2] ?? null }
    })
}

/** A recipe's identity: its tokens in order, "1:person 2:face". Bare tokens
 *  read "1:", so `{image:1}` and `{image:1:person}` stay distinct. */
export function recipeKey(prompt: string): string {
  return parseImageTokens(prompt)
    .filter((p) => p.n !== null)
    .map((p) => `${p.n}:${p.qualifier ?? ""}`)
    .join(" ")
}

/** One source image, in `{image:N}` order for the recipe (or the template). */
export interface RecipeSource {
  readonly position: number
  readonly nodeId: string
  /** "generated" for an image node's output, "uploaded" for an upload node. */
  readonly kind: "generated" | "uploaded"
  readonly label: string
  readonly imageUrl: string | null
}

/** One borrowed fragment: `{image:2:face}` resolved to its source. */
export interface RecipeBorrow {
  readonly n: number
  readonly qualifier: string
  /** `{image:2:face}` — the token as written. */
  readonly token: string
  readonly source: RecipeSource | null
}

export interface Recipe {
  /** 1-based, in lesson order (authored order first, then canvas order). */
  readonly index: number
  readonly nodeId: string
  readonly label: string
  readonly prompt: string
  readonly key: string
  readonly parts: PromptPart[]
  readonly borrows: RecipeBorrow[]
  /** The recipe's own reference list, in `{image:N}` order. */
  readonly sources: RecipeSource[]
  readonly provider: string | null
  readonly resolution: string | null
  readonly aspectRatio: string | null
  readonly resultUrl: string | null
}

export interface OneCharacterGraph {
  /** The template's sources — the first recipe's reference list (every recipe
   *  is wired to the same two, which is the point; the body says so). */
  readonly sources: RecipeSource[]
  readonly recipes: Recipe[]
  /** True when every recipe reads the same sources in the same order. */
  readonly sharedSources: boolean
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

function sourceOf(node: WorkflowNode | undefined, position: number, fallbackName: string): RecipeSource | null {
  if (!node) return null
  const d = (node.data ?? {}) as NodeData
  return {
    position,
    nodeId: node.id,
    kind: node.type === "upload-image" ? "uploaded" : "generated",
    label: str(d.label) ?? fallbackName,
    imageUrl: nodeMedia(node) ?? str(d.thumbnailUrl) ?? str(d.url) ?? null,
  }
}

/** Every generate-image node whose prompt borrows parts of wired references. */
function isRecipe(node: WorkflowNode, edges: WorkflowEdge[]): boolean {
  if (node.type !== "generate-image") return false
  const prompt = str(((node.data ?? {}) as NodeData).prompt) ?? ""
  if (!parseImageTokens(prompt).some((p) => p.n !== null)) return false
  return edges.some((e) => e.target === node.id && (e.targetHandle ?? "references") === "references")
}

/**
 * @param order the authored lesson order, as recipe keys — recipes whose
 *   prompt matches one of them come first in that order; any others follow in
 *   canvas order (top to bottom), so a re-authored template still renders.
 */
export function deriveOneCharacterGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  order: readonly string[] = [],
): OneCharacterGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const candidates = nodes.filter((n) => isRecipe(n, edges))
  const rank = new Map(order.map((k, i) => [k, i]))
  const sorted = [...candidates].sort((a, b) => {
    const ra = rank.get(recipeKey(str((a.data as NodeData).prompt) ?? "")) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(recipeKey(str((b.data as NodeData).prompt) ?? "")) ?? Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0)
  })

  const recipes: Recipe[] = sorted.map((node, i) => {
    const d = (node.data ?? {}) as NodeData
    const prompt = str(d.prompt) ?? ""
    const refs = deriveReferences(nodes, edges, node.id)
    const sources = refs
      .map((r) => sourceOf(byId.get(r.nodeId), r.position, r.name))
      .filter((s): s is RecipeSource => s !== null)
    const bySlot = new Map(sources.map((s) => [s.position, s]))
    const parts = parseImageTokens(prompt)
    const borrows: RecipeBorrow[] = parts
      .filter((p): p is PromptPart & { n: number } => p.n !== null)
      .map((p) => ({ n: p.n, qualifier: p.qualifier ?? "", token: p.text, source: bySlot.get(p.n) ?? null }))
    return {
      index: i + 1,
      nodeId: node.id,
      label: str(d.label) ?? `Recipe ${i + 1}`,
      prompt,
      key: recipeKey(prompt),
      parts,
      borrows,
      sources,
      provider: str(d.provider),
      resolution: str(d.resolution),
      aspectRatio: str(d.aspectRatio),
      resultUrl: nodeMedia(node),
    }
  })

  const sources = recipes[0]?.sources ?? []
  const signature = (r: Recipe) => r.sources.map((s) => s.nodeId).join("|")
  const sharedSources = recipes.length > 0 && recipes.every((r) => signature(r) === signature(recipes[0]))
  return { sources, recipes, sharedSources }
}
