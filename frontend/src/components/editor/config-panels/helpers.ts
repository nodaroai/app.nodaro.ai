import type { WorkflowNode, WorkflowEdge, FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"
import { buildCreditModelIdentifier as sharedBuildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier } from "@nodaro-shared/credit-identifiers"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
import type { LlmFeature } from "@nodaro-shared/llm-models"

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
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      nodeData: d,
      edgeOutputMode: (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined,
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

/** Map node types that use LLM models to their credit feature names */
const LLM_NODE_FEATURE_MAP: Record<string, LlmFeature> = {
  "ai-writer": "ai-writer",
  "llm-chat": "llm-chat",
  "video-composer": "scene-graph-ai",
  "after-effects": "after-effects",
  "lottie-overlay": "lottie-overlay",
  "3d-title": "3d-title",
  "motion-graphics": "motion-graphics",
  "generate-script": "generate-script",
  "qa-check": "qa-check",
  "image-to-text": "image-to-text",
}

export function getModelIdentifier(node: WorkflowNode): string {
  const data = node.data as Record<string, unknown>

  // Component nodes: return empty string so the fallback estimateNodeCredits is used
  // (component cost depends on estimatedCredits from the published metadata, not a model lookup)
  if (node.type === "component") return ""

  // LLM-powered nodes: use composite credit identifier based on selected model tier
  const llmFeature = LLM_NODE_FEATURE_MAP[node.type ?? ""]
  if (llmFeature) {
    return buildLlmCreditIdentifier(llmFeature, (data.llmModel as string | undefined) || LLM_FEATURE_DEFAULTS[llmFeature])
  }

  const nodeType = node.type ?? "unknown"

  // Suno generate/cover/extend use "model" field (V4/V5), not "provider"
  if (nodeType.startsWith("suno-") && nodeType !== "suno-lyrics" && nodeType !== "suno-separate" && nodeType !== "suno-music-video") {
    return (data.model as string) === "V5" ? "suno-v5" : nodeType
  }

  // Suno separate: "split_stem" costs more than "separate_vocal"
  if (nodeType === "suno-separate") {
    return (data.type as string) === "split_stem" ? "suno-separate-stem" : "suno-separate"
  }

  // Entity nodes: use provider field (default nano-banana)
  if (nodeType === "character" || nodeType === "face" || nodeType === "object" || nodeType === "location") {
    const entityProvider = (data.provider as string) || "nano-banana"
    return buildCreditModelIdentifier(entityProvider, data)
  }

  const provider = data.provider as string | undefined
  if (!provider) return nodeType

  // Extend-video: VEO quality costs more than fast
  if (nodeType === "extend-video" && provider === "veo-extend" && data.model === "quality") {
    return "veo-extend:quality"
  }

  // Motion transfer: duration-tiered pricing
  if (nodeType === "motion-transfer") {
    return buildMotionCreditModelIdentifier(
      (data.provider as string) ?? "kling",
      (data.resolution as string) ?? "720p",
      data.videoDuration as number | undefined,
    )
  }

  // Video nodes with duration/audio-based variable pricing or T2V cost overrides
  if (nodeType === "image-to-video" || nodeType === "text-to-video") {
    const duration = data.duration as number | string | undefined
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    const videoNodeType = nodeType as "image-to-video" | "text-to-video"
    const resolution = data.resolution as string | undefined
    const refVideos = data.referenceVideoUrls as string[] | undefined
    const hasVideoRef = Array.isArray(refVideos) && refVideos.length > 0
    return buildVideoCreditModelIdentifier(
      provider,
      duration,
      sound,
      videoNodeType,
      (data.videoSize ?? data.mode) as string | undefined,
      resolution,
      hasVideoRef,
    )
  }

  return buildCreditModelIdentifier(provider, data)
}

/**
 * Build composite credit model identifier from provider + node data.
 * Extracts quality/resolution/renderingSpeed from data and delegates to the shared function.
 */
export function buildCreditModelIdentifier(provider: string, data: Record<string, unknown>): string {
  return sharedBuildCreditModelIdentifier(
    provider,
    data.quality as string | undefined,
    data.resolution as string | undefined,
    data.renderingSpeed as string | undefined,
    data.targetResolution as string | undefined,
  )
}
