// Read the Camera Coverage shape off its snapshot.
//
// The template is a chain that fans out at the end:
//   reference prompt → REFERENCE FRAME (one image)
//   brief + frame   → LLM (ten lines) → split → SHOT LIST (list)
//   shot list + frame → COVERAGE SHOT (one image node, run once per row)
//   coverage shot   → gallery list(s)
// Nothing here is keyed on a node id or a label, because the lesson has to
// survive the template being re-published with different ids: the roles are
// found from types + wiring — the image node the list feeds is the fan-out,
// the image node feeding BOTH the LLM and the fan-out is the anchor, and so on.

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { nodeMedia, nodeOutputText, nodeText } from "../derive-tutorial-data"

type NodeData = Record<string, unknown>

export interface CoverageShot {
  /** 1-based position in the shot list. */
  index: number
  /** The prompt line for this shot. */
  line: string
  /** The generated image for this position, when the run produced one. */
  imageUrl: string | null
}

export interface CoverageGraph {
  anchor: {
    nodeId: string
    prompt: string
    imageUrl: string | null
    /** The frame's configured aspect ratio ("16:9"), shown as the column meta. */
    aspectRatio: string | null
  } | null
  brief: { nodeId: string; text: string } | null
  planner: { nodeId: string; model: string | null } | null
  shots: CoverageShot[]
  fanOut: { nodeId: string; label: string; model: string | null; count: number } | null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []
}

/** Every generated image URL on a node, in result order (fan-out nodes carry one per row). */
function nodeImages(node: WorkflowNode | undefined): string[] {
  if (!node) return []
  const d = (node.data ?? {}) as NodeData
  const results = Array.isArray(d.generatedResults) ? (d.generatedResults as NodeData[]) : []
  const urls = results.map((r) => str(r.url)).filter((u): u is string => !!u)
  if (urls.length > 0) return urls
  const one = nodeMedia(node)
  return one ? [one] : []
}

/** The rows a list node currently shows: its own rows, or (for a connected
 *  column) the split results of the node feeding it. */
function listLines(list: WorkflowNode | undefined, nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  if (!list) return []
  const d = (list.data ?? {}) as NodeData
  const rows = Array.isArray(d.rows) ? (d.rows as unknown[][]) : []
  const own = rows.map((r) => (Array.isArray(r) ? str(r[0]) : null)).filter((x): x is string => !!x)
  if (own.length > 0) return own
  // Connected column: walk one edge upstream to the producer of the lines.
  const feed = edges.find((e) => e.target === list.id)
  const src = feed ? nodes.find((n) => n.id === feed.source) : undefined
  if (!src) return []
  const sd = (src.data ?? {}) as NodeData
  const split = strList(sd.splitResults)
  if (split.length > 0) return split
  return nodeOutputText(src).split("\n").map((s) => s.trim()).filter(Boolean)
}

export function deriveCoverageGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): CoverageGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const imageNodes = nodes.filter((n) => n.type === "generate-image")
  const lists = nodes.filter((n) => n.type === "list")

  // Fan-out = the image node that a LIST feeds (a list → prompt edge).
  const fanOut = imageNodes.find((img) =>
    edges.some((e) => e.target === img.id && byId.get(e.source)?.type === "list"),
  )
  // Anchor = the image node that feeds BOTH the planner (the LLM reads it to
  // write coverage) and the fan-out (every shot references it). That double
  // role is what makes it the scene's anchor; a second image wired only into
  // the fan-out's references (an extra style ref, say) is not it. Fall back to
  // any image feeding the fan-out, then to any image feeding an LLM.
  const feeds = (from: WorkflowNode, toType: string) =>
    edges.some((e) => e.source === from.id && byId.get(e.target)?.type === toType)
  const feedsFanOut = (img: WorkflowNode) => !!fanOut && img.id !== fanOut.id && edges.some((e) => e.source === img.id && e.target === fanOut.id)
  const anchor =
    imageNodes.find((img) => feedsFanOut(img) && feeds(img, "llm-chat")) ??
    imageNodes.find(feedsFanOut) ??
    imageNodes.find((img) => feeds(img, "llm-chat"))
  // Planner = the LLM the anchor feeds (or the only llm-chat).
  const planner =
    nodes.find((n) => n.type === "llm-chat" && anchor && edges.some((e) => e.source === anchor.id && e.target === n.id)) ??
    nodes.find((n) => n.type === "llm-chat")
  // Brief = a text-prompt feeding the planner's prompt.
  const brief = planner
    ? nodes.find((n) => n.type === "text-prompt" && edges.some((e) => e.source === n.id && e.target === planner.id && (e.targetHandle ?? "prompt") === "prompt"))
    : undefined
  // Shot list = the list that feeds the fan-out.
  const shotList = fanOut ? lists.find((l) => edges.some((e) => e.source === l.id && e.target === fanOut.id)) : undefined
  // Reference prompt = the text-prompt feeding the anchor.
  const anchorPrompt = anchor
    ? nodes.find((n) => n.type === "text-prompt" && edges.some((e) => e.source === n.id && e.target === anchor.id))
    : undefined

  const lines = listLines(shotList, nodes, edges)
  const images = nodeImages(fanOut)
  const count = Math.max(lines.length, images.length)
  const shots: CoverageShot[] = Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    line: lines[i] ?? "",
    imageUrl: images[i] ?? null,
  }))

  const model = (n: WorkflowNode | undefined): string | null => {
    if (!n) return null
    const d = (n.data ?? {}) as NodeData
    return str(d.llmModel) ?? str(d.provider) ?? null
  }

  return {
    anchor: anchor
      ? {
          nodeId: anchor.id,
          prompt: anchorPrompt ? nodeText(anchorPrompt) : "",
          imageUrl: nodeMedia(anchor),
          aspectRatio: str(((anchor.data ?? {}) as NodeData).aspectRatio),
        }
      : null,
    brief: brief ? { nodeId: brief.id, text: nodeText(brief) } : null,
    planner: planner ? { nodeId: planner.id, model: model(planner) } : null,
    shots,
    fanOut: fanOut
      ? { nodeId: fanOut.id, label: str(((fanOut.data ?? {}) as NodeData).label) ?? "Coverage Shot", model: model(fanOut), count }
      : null,
  }
}
