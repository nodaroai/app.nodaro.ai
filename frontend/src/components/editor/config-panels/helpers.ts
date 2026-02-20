import type { WorkflowNode, WorkflowEdge, FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

export const FIELD_COMPATIBLE_TYPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  prompt: ["text-prompt"],
  negativePrompt: ["text-prompt"],
  style: ["style-guide"],
  styleGuide: ["style-guide"],
  tone: ["text-prompt", "tone"],
  provider: ["provider"],
  aspectRatio: ["aspect-ratio"],
  duration: ["duration"],
  targetLength: ["duration"],
  motion: ["motion"],
  cameraMotion: ["camera-motion"],
  sceneCount: ["scene-count"],
}

export function getCompatibleSources(
  field: string,
  sources: ReadonlyArray<SourceNodeInfo>,
  providerCategory?: string,
): ReadonlyArray<SourceNodeInfo> {
  const compatibleTypes = FIELD_COMPATIBLE_TYPES[field]
  if (!compatibleTypes) return sources

  const filtered = sources.filter((s) => {
    if (!compatibleTypes.includes(s.type)) return false
    if (s.type === "provider" && providerCategory && s.providerCategory !== providerCategory) return false
    return true
  })

  // Deduplicate by id to avoid React key warnings
  const seen = new Set<string>()
  return filtered.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

export function getConnectedSources(
  nodeId: string,
  edges: ReadonlyArray<WorkflowEdge>,
  nodes: ReadonlyArray<WorkflowNode>,
): ReadonlyArray<SourceNodeInfo> {
  const sources: SourceNodeInfo[] = []
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source) continue
    const d = source.data as Record<string, unknown>
    sources.push({
      id: source.id,
      type: source.type as string,
      label: (d.label as string) ?? source.type ?? source.id,
      value: extractDisplayValue(d, source.type as string),
      providerCategory: source.type === "provider" ? (d.category as string) : undefined,
      targetHandle: edge.targetHandle ?? undefined,
      nodeData: d,
    })
  }
  return sources
}

export function getConnectedProviderModel(
  fieldMappings: FieldMappings,
  sources: ReadonlyArray<SourceNodeInfo>,
  nodes: ReadonlyArray<WorkflowNode>,
): string | undefined {
  const providerMapping = fieldMappings.provider
  if (!providerMapping) return undefined
  const source = sources.find((s) => s.id === providerMapping.sourceNodeId)
  if (!source || source.type !== "provider") return undefined
  const sourceNode = nodes.find((n) => n.id === source.id)
  if (!sourceNode) return undefined
  const d = sourceNode.data as Record<string, unknown>
  return (d.model as string) ?? undefined
}

export function extractDisplayValue(data: Record<string, unknown>, nodeType: string): string {
  switch (nodeType) {
    case "text-prompt":
      return (data.text as string) ?? ""
    case "tone":
      return (data.tone as string) ?? ""
    case "style-guide":
      return (data.text as string) ?? ""
    case "provider":
      return `${data.provider ?? ""}/${data.model ?? ""}`
    case "scene-count":
      return `${data.count ?? ""} scenes`
    case "duration":
      return `${data.seconds ?? ""}s`
    case "aspect-ratio":
      return (data.ratio as string) ?? ""
    case "motion":
      return (data.motion as string) ?? ""
    case "camera-motion":
      return (data.cameraMotion as string) ?? ""
    case "reference-audio":
      return (data.videoTitle as string) || (data.extractedAudioUrl as string) ? "Audio ready" : "No audio"
    default:
      return (data.label as string) ?? ""
  }
}

export function getModelIdentifier(node: WorkflowNode): string {
  // AI Writer always uses "ai-writer" for credit cost lookup (not the LLM provider name)
  if (node.type === "ai-writer") return "ai-writer"
  const data = node.data as Record<string, unknown>
  const provider = data.provider as string | undefined
  if (provider) return provider
  return node.type ?? "unknown"
}
