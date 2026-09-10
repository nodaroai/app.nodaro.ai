// Turn a template snapshot into the shape a tutorial body renders.
//
// Everything here is DERIVED from the workflow the tutorial teaches, never
// re-typed into a content file. Republishing the template updates the tutorial;
// there is nothing to keep in sync by hand. Only prose that has no home in the
// graph (step titles, per-token explanations) lives in a tutorial's content.ts.

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/** One reference image feeding a multi-reference node, in `{image:N}` order. */
export interface TutorialReference {
  /** 1-based position — this is the N in `{image:N}`. */
  position: number
  nodeId: string
  /** The node's label on the canvas ("Ryan"). */
  name: string
  /** Thumbnail if the upload has one, else the full image. */
  imageUrl: string | null
}

export interface TutorialGraph {
  references: TutorialReference[]
  prompt: string
  resultImageUrl: string | null
  /** Model settings shown as chips, e.g. ["GPT Image 2", "2K", "16:9"]. */
  modelChips: string[]
  consumerNodeId: string | null
}

type NodeData = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

function nodeImageUrl(data: NodeData): string | null {
  const results = data.generatedResults
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as NodeData
    return str(first.thumbnailUrl) ?? str(first.url) ?? null
  }
  return str(data.thumbnailUrl) ?? str(data.r2Url) ?? str(data.url) ?? null
}

/**
 * `{image:N}` numbering comes from the ORDER THE EDGES WERE CREATED, not from
 * node ids, labels or canvas position — that is the single most misunderstood
 * thing about multi-reference prompts, and it is exactly what the tutorial
 * teaches. So read the order straight off the edge list rather than sorting by
 * anything that merely looks stable.
 */
export function deriveReferences(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  consumerId: string,
  handleId = "references",
): TutorialReference[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const refs: TutorialReference[] = []
  for (const edge of edges) {
    if (edge.target !== consumerId) continue
    if (edge.targetHandle && edge.targetHandle !== handleId) continue
    const node = byId.get(edge.source)
    if (!node) continue
    const data = (node.data ?? {}) as NodeData
    refs.push({
      position: refs.length + 1,
      nodeId: node.id,
      name: str(data.label) ?? `Reference ${refs.length + 1}`,
      imageUrl: nodeImageUrl(data),
    })
  }
  return refs
}

/** Human labels for the model ids the graph stores. Unknown ids pass through. */
const MODEL_LABELS: Record<string, string> = {
  "gpt-image-2": "GPT Image 2",
  "gpt-image-2-5-flare": "GPT Image 2.5 Flare",
  "gpt-image-2-5-sunburst": "GPT Image 2.5 Sunburst",
  "gpt-image": "GPT Image",
  "nano-banana": "Nano Banana",
  "nano-banana-pro": "Nano Banana Pro",
  "flux": "Flux",
  "grok": "Grok",
  "z-image": "Z-Image",
  "ideogram-v3": "Ideogram v3",
}

function modelChips(data: NodeData): string[] {
  const provider = str(data.provider)
  return [
    provider ? (MODEL_LABELS[provider] ?? provider) : null,
    str(data.resolution),
    str(data.aspectRatio),
  ].filter((v): v is string => v !== null)
}

/**
 * Find the node the tutorial is about (the one references fan into) and read
 * its prompt, result and settings off the snapshot.
 */
export function deriveTutorialGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  consumerType = "generate-image",
): TutorialGraph {
  const consumer = nodes.find((n) => n.type === consumerType)
  if (!consumer) {
    return { references: [], prompt: "", resultImageUrl: null, modelChips: [], consumerNodeId: null }
  }
  const data = (consumer.data ?? {}) as NodeData
  return {
    references: deriveReferences(nodes, edges, consumer.id),
    prompt: str(data.prompt) ?? "",
    resultImageUrl: nodeImageUrl(data),
    modelChips: modelChips(data),
    consumerNodeId: consumer.id,
  }
}

/**
 * Read one node's authored text — its prompt, or the plain text of a text node.
 * Returns "" rather than undefined so a tutorial never renders "undefined".
 */
export function nodeText(node: { data?: unknown } | undefined): string {
  if (!node) return ""
  const data = (node.data ?? {}) as NodeData
  return str(data.prompt) ?? str(data.text) ?? ""
}

/**
 * Read what a node PRODUCED, as text.
 *
 * Distinct from `nodeText`, which reads what a node was GIVEN. A generator's
 * output lives in its results, so asking for `data.text` on an LLM node returns
 * nothing and the tutorial renders an empty box under a step that did work.
 */
export function nodeOutputText(node: { data?: unknown } | undefined): string {
  if (!node) return ""
  const data = (node.data ?? {}) as NodeData
  const direct = str(data.generatedText) ?? str(data.generatedContent)
  if (direct) return direct

  const results = data.generatedResults
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as NodeData
    const fromResult =
      str(first.text) ?? str(first.content) ?? str(first.output) ?? str(first.generatedText)
    if (fromResult) return fromResult
  }
  return ""
}

/** Read one node's generated media URL (image, video or audio). */
export function nodeMedia(node: { data?: unknown } | undefined): string | null {
  if (!node) return null
  const data = (node.data ?? {}) as NodeData
  const results = data.generatedResults
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as NodeData
    const url = str(first.url)
    if (url) return url
  }
  return (
    str(data.generatedVideoUrl) ??
    str(data.generatedImageUrl) ??
    str(data.generatedAudioUrl) ??
    str(data.url) ??
    null
  )
}

/** Read one arbitrary scalar field off a node, as a display string. */
export function nodeField(node: { data?: unknown } | undefined, field: string): string | null {
  if (!node) return null
  const value = ((node.data ?? {}) as NodeData)[field]
  if (typeof value === "number") return String(value)
  return str(value)
}

/**
 * Split a prompt into plain runs and `{image:N}` tokens for inline chip
 * rendering. The capturing group keeps the delimiters, so joining the parts
 * reproduces the prompt exactly.
 */
export function tokenizePrompt(prompt: string): Array<{ text: string; token: number | null }> {
  return prompt
    .split(/(\{image:\d+\})/)
    .filter((part) => part !== "")
    .map((part) => {
      const match = part.match(/^\{image:(\d+)\}$/)
      return { text: part, token: match ? Number(match[1]) : null }
    })
}
