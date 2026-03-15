/**
 * Inline executors for nodes that don't need a BullMQ job.
 * These run synchronously in the orchestrator process.
 */

import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeOutput, NodeExecutionState } from "./types.js"
import { getPrimaryOutput, extractSourceNodeOutput } from "./output-extractor.js"
import { isSourceNode } from "./execution-graph.js"

/**
 * Execute combine-text node: joins upstream text outputs with a separator.
 */
export function executeCombineText(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const separator = (node.data.separator as string) ?? "\n"
  const incomingEdges = edges.filter((e) => e.target === node.id)

  const texts: string[] = []
  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (!state?.output) continue
    const text = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
    if (text) texts.push(text)
  }

  const combined = texts.join(separator)
  return { text: combined, combinedText: combined }
}

/**
 * Execute split-text node: splits text by delimiter.
 */
export function executeSplitText(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
): NodeOutput {
  const text = resolvedInputs.prompt || (node.data.text as string) || ""
  const delimiter = (node.data.delimiter as string) ?? "\n"
  const splitResults = text
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  return {
    text: splitResults[0] || "",
    splitResults,
  }
}

/**
 * Execute composite node: build composite plan from layer config + upstream video URLs.
 * The composite plan is sent to the render queue by the render-video node downstream.
 */
export function executeComposite(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const data = node.data
  const layout = (data.layout as string) ?? "pip"
  const width = (data.width as number) ?? 1920
  const height = (data.height as number) ?? 1080
  const fps = (data.fps as number) ?? 30

  // Collect incoming video URLs
  const incomingEdges = edges.filter((e) => e.target === node.id)
  const layers: Array<{
    url: string
    x: number
    y: number
    width: number
    height: number
    opacity: number
    zIndex: number
  }> = []

  const layerConfigs = (data.layers as Array<Record<string, unknown>>) ?? []

  for (let i = 0; i < incomingEdges.length; i++) {
    const edge = incomingEdges[i]
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (!state?.output) continue
    const url = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
    if (!url) continue

    const layerConfig = layerConfigs[i] ?? {}
    layers.push({
      url,
      x: (layerConfig.x as number) ?? 0,
      y: (layerConfig.y as number) ?? 0,
      width: (layerConfig.width as number) ?? width,
      height: (layerConfig.height as number) ?? height,
      opacity: (layerConfig.opacity as number) ?? 1,
      zIndex: i,
    })
  }

  const compositePlan = {
    planType: "composite",
    layout,
    width,
    height,
    fps,
    layers,
  }

  return { plan: compositePlan }
}

/**
 * Execute preview node: passthrough — collects upstream output and forwards the first value.
 */
export function executePreview(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): NodeOutput {
  const incomingEdges = edges.filter((e) => e.target === node.id)
  let firstOutput: string | undefined

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const state = nodeStates[srcNode.id]
    if (!state?.output) continue
    const value = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
    if (value) {
      firstOutput = value
      break
    }
  }

  return firstOutput ? { text: firstOutput } : {}
}

/**
 * Execute webhook-output node: collect upstream outputs and POST to configured URL.
 */
export async function executeWebhookOutput(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): Promise<NodeOutput> {
  const url = (node.data.url as string)?.trim()
  if (!url) {
    throw new Error("No webhook URL configured")
  }

  const params = (node.data.params as Array<{ id: string; name: string; type: string }>) ?? []
  const incomingEdges = edges.filter((e) => e.target === node.id)

  const payload: Record<string, unknown> = {}

  if (params.length > 0) {
    // Param-based: match each param to its connected edge by targetHandle
    for (const param of params) {
      const edge = incomingEdges.find((e) => e.targetHandle === param.id)
      if (!edge) continue
      const srcNode = allNodes.find((n) => n.id === edge.source)
      if (!srcNode) continue

      let value: string | undefined
      const state = nodeStates[srcNode.id]
      if (state?.output) {
        value = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      } else if (isSourceNode(srcNode.type)) {
        const srcOutput = extractSourceNodeOutput(srcNode)
        if (srcOutput) value = getPrimaryOutput(srcOutput, srcNode.type, edge.sourceHandle)
      }
      if (value) payload[param.name] = value
    }
  } else {
    // No params — collect all upstream data
    for (const edge of incomingEdges) {
      const srcNode = allNodes.find((n) => n.id === edge.source)
      if (!srcNode) continue
      const state = nodeStates[srcNode.id]
      if (!state?.output) continue
      const value = getPrimaryOutput(state.output, srcNode.type, edge.sourceHandle)
      if (value) payload[srcNode.type] = value
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Webhook POST failed (${response.status}): ${body.slice(0, 200)}`)
  }

  return { text: "sent" }
}
