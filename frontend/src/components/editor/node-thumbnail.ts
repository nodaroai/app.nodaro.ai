/**
 * The picture a node can lend the workflow as its thumbnail: the dashboard
 * card, and the cover a template takes when it is published or updated from
 * the workflow.
 *
 * A generation node lends its result. An Upload Image node lends the image it
 * holds, read exactly as a run reads it (extractNodeOutput), so the menu and
 * the run never disagree about which image the node has. Every other node has
 * no picture to lend.
 */
import type { WorkflowNode } from "@/types/nodes"
import { extractNodeOutput } from "./workflow-editor/execution-graph"

function filled(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

export function nodeThumbnailUrl(node: WorkflowNode | undefined): string | null {
  if (!node) return null
  const data = (node.data ?? {}) as Record<string, unknown>
  const generated = filled(data.generatedImageUrl) ?? filled(data.generatedVideoUrl)
  if (generated) return generated
  if (node.type === "upload-image") return filled(extractNodeOutput(node))
  return null
}
