/**
 * Build BullMQ job payloads for each node type from node data + resolved inputs.
 * Returns { jobName, queueName, payload } for worker-queued nodes.
 */

import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState } from "./types.js"

// Shared logic from packages/shared — single source of truth
import { collectAncestorRefs as sharedCollectAncestorRefs } from "../../../../packages/shared/src/ancestor-refs.js"
import { buildImagePrompt, buildScenePrompt, buildEnrichedScenePrompt, type EnrichableScene } from "../../../../packages/shared/src/prompt-builder.js"
import { resolveTemplate, applyTemplate } from "../../../../packages/shared/src/prompt-templates.js"
import { buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier } from "../../../../packages/shared/src/credit-identifiers.js"
import { resolveNodeRefs } from "../../../../packages/shared/src/node-refs.js"
import type { CharacterDef, SceneData } from "../../../../packages/shared/src/types.js"
import { PLATFORM_SPECS } from "../../../../packages/shared/src/social-media-specs.js"
import { COMPOSER_PLAN_MAP, ASPECT_RATIO_DIMENSIONS } from "../../../../packages/shared/src/model-constants.js"
import { extractSavedNodeOutput, extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import { IMAGE_SOURCE_TYPES, VIDEO_SOURCE_TYPES, AUDIO_SOURCE_TYPES, isSourceNode } from "./execution-graph.js"

// ---------------------------------------------------------------------------
// Character definitions + prompt template types (from workflow settings)
// ---------------------------------------------------------------------------

export interface CharacterDefinition {
  id: string
  name: string
  type: "reference" | "description"
  category?: "character" | "face" | "location" | "object"
  referenceImageUrl?: string
  description?: string
}

export interface WorkflowSettings {
  characterDefinitions?: CharacterDefinition[]
  flowPromptTemplates?: Record<string, string>
  /** User-level prompt templates from profiles.prompt_templates */
  userPromptTemplates?: Record<string, string>
}

/** Context passed to buildPayload for nodes that need workflow-level data. */
export interface PayloadBuildContext {
  settings?: WorkflowSettings
  nodes?: SimpleNode[]
  edges?: SimpleEdge[]
  nodeStates?: Record<string, NodeExecutionState>
}

// ---------------------------------------------------------------------------
// Ancestor reference image collection — delegates to shared implementation
// ---------------------------------------------------------------------------

/** Get image URL from execution state, falling back to saved node data (matches frontend). */
function getNodeImageUrl(
  node: SimpleNode,
  nodeStates: Record<string, NodeExecutionState>,
): string | undefined {
  return nodeStates[node.id]?.output?.imageUrl ?? extractSavedNodeOutput(node)?.imageUrl
}

function collectAncestorRefs(
  nodeId: string,
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  visited = new Set<string>(),
): string[] {
  return sharedCollectAncestorRefs(
    nodeId,
    nodes,
    edges,
    (src) => getNodeImageUrl(src, nodeStates),
    visited,
  )
}

// ---------------------------------------------------------------------------
// Apply user-specified ordering to a list of items with IDs
// ---------------------------------------------------------------------------

function applyOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (!order.length) return [...items]
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const item = items.find((i) => i.id === id)
    if (item) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item)
    }
  }
  return ordered
}

interface PayloadResult {
  /** BullMQ job name (e.g., "generate-image") */
  jobName: string
  /** Queue to add to: "video-generation" or "video-render" */
  queueName: "video-generation" | "video-render"
  /** Job data payload */
  payload: Record<string, unknown>
  /** Model identifier for credit reservation */
  modelIdentifier: string
}

/** Shorthand for FFmpeg nodes that all share queueName + modelIdentifier. */
function ffmpegResult(
  jobName: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier: jobName,
    payload,
  }
}

/** Shorthand for nodes with a fixed model identifier and no provider selection. */
function simpleResult(
  jobName: string,
  modelIdentifier: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier,
    payload,
  }
}

// ---------------------------------------------------------------------------
// List-like node helpers for buildNodeRefMap edge-aware output extraction
// ---------------------------------------------------------------------------

const LIST_LIKE_TYPES = new Set(["list", "loop", "split-text"])

/** Return the outputMode from connecting edges, defaulting to "each" for list-like nodes. */
function getEdgeOutputMode(
  connectingEdges: ReadonlyArray<SimpleEdge>,
): string {
  for (const edge of connectingEdges) {
    const mode = (edge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined
    if (mode) return mode
  }
  return "each"
}

/** Parse the list of items from a list/loop/split-text node. */
function extractListItems(
  node: SimpleNode,
  states: Record<string, NodeExecutionState>,
): string[] {
  const data = node.data
  if (node.type === "list") {
    return ((data.items as string | undefined) || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }
  if (node.type === "loop") {
    const rows = data.rows as string[][] | undefined
    return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
  }
  if (node.type === "split-text") {
    const state = states[node.id]
    if (state?.output?.splitResults) return state.output.splitResults
    return (data.splitResults as string[] | undefined) ?? []
  }
  return []
}

/** Resolve a list of items using the given output mode. */
function resolveListOutput(
  items: string[],
  mode: string,
): string | undefined {
  if (items.length === 0) return undefined
  if (mode === "last") return items[items.length - 1]
  if (mode.startsWith("item:")) {
    const idx = parseInt(mode.split(":")[1], 10)
    return items[idx] ?? items[0]
  }
  if (mode === "all") return items.join(", ")
  // "each" — return first item; fan-out clones get their own item via execution engine
  return items[0]
}

/**
 * Build a label→output map for resolving {Node Label} refs in text fields.
 * Uses BFS with edge tracking so list/loop/split-text nodes respect the
 * connecting edge's outputMode (e.g. "item:1", "last", "all").
 */
export function buildNodeRefMap(
  nodeId: string,
  ctx?: PayloadBuildContext,
): Map<string, string> {
  const map = new Map<string, string>()
  if (!ctx?.nodes || !ctx?.edges || !ctx?.nodeStates) return map

  const nodes = ctx.nodes
  const edges = ctx.edges
  const states = ctx.nodeStates
  const visited = new Set<string>()
  const queue: Array<{ id: string; connectingEdges: ReadonlyArray<SimpleEdge> }> = []

  // Seed BFS with direct parents, grouping edges by source
  const seedEdges = new Map<string, SimpleEdge[]>()
  for (const edge of edges) {
    if (edge.target === nodeId) {
      if (!seedEdges.has(edge.source)) seedEdges.set(edge.source, [])
      seedEdges.get(edge.source)!.push(edge)
    }
  }
  for (const [sourceId, edgeGroup] of seedEdges) {
    visited.add(sourceId)
    queue.push({ id: sourceId, connectingEdges: edgeGroup })
  }

  while (queue.length > 0) {
    const { id: currentId, connectingEdges } = queue.shift()!
    const node = nodes.find((n) => n.id === currentId)
    if (!node) continue

    const label = (node.data.label as string) || node.type || currentId

    // List-like nodes always go through list extraction (even "each" is not
    // regular behavior — it's fan-out, so the ref should resolve via items)
    let output: string | undefined
    if (LIST_LIKE_TYPES.has(node.type)) {
      const mode = getEdgeOutputMode(connectingEdges)
      const items = extractListItems(node, states)
      output = resolveListOutput(items, mode)
    }

    // All other nodes: extract from state or node data
    if (output === undefined) {
      const state = states[currentId]
      if (state?.output?.text) {
        output = state.output.text
      } else if (state?.output?.imageUrl) {
        output = state.output.imageUrl
      } else if (state?.output?.videoUrl) {
        output = state.output.videoUrl
      } else if (state?.output?.audioUrl) {
        output = state.output.audioUrl
      } else {
        const saved = extractSavedNodeOutput(node)
        if (saved) {
          output = saved.text ?? saved.imageUrl ?? saved.videoUrl ?? saved.audioUrl
        }
      }
    }

    if (output) map.set(label, output)

    // BFS: traverse to parents of current node
    const nextEdges = new Map<string, SimpleEdge[]>()
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
        if (!nextEdges.has(edge.source)) nextEdges.set(edge.source, [])
        nextEdges.get(edge.source)!.push(edge)
      }
    }
    for (const [sourceId, edgeGroup] of nextEdges) {
      visited.add(sourceId)
      queue.push({ id: sourceId, connectingEdges: edgeGroup })
    }
  }

  return map
}

/** Resolve {Node Label} refs in a text string if the map is non-empty. */
function resolveRefs(text: string | undefined, refMap: Map<string, string>): string | undefined {
  if (!text || refMap.size === 0) return text
  return resolveNodeRefs(text, refMap)
}

export function buildPayload(
  node: SimpleNode,
  jobId: string,
  resolvedInputs: ResolvedInputs,
  usageLogId?: string,
  buildCtx?: PayloadBuildContext,
): PayloadResult {
  const data = node.data
  const type = node.type

  // Build label→output map for resolving {Node Label} refs in text fields
  const refMap = buildNodeRefMap(node.id, buildCtx)
  // Pre-resolve refs in the upstream prompt so all downstream code sees clean text
  if (resolvedInputs.prompt && refMap.size > 0) {
    resolvedInputs.prompt = resolveRefs(resolvedInputs.prompt, refMap)
  }

  switch (type) {
    // --- Image generation ---
    case "generate-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings

      // Build a map of all available reference images by ID
      const refUrlMap = new Map<string, string>()

      // Manual uploads (new multi-image format: ManualReferenceImage[])
      const manualRefs = data.referenceImageUrls as Array<{ id: string; url: string }> | undefined
      if (manualRefs?.length) {
        for (const img of manualRefs) {
          refUrlMap.set(img.id, img.url)
        }
      }
      // Legacy single referenceImageUrl
      const nodeRefUrl = data.referenceImageUrl as string | undefined
      if (nodeRefUrl && refUrlMap.size === 0) {
        refUrlMap.set("__legacy__", nodeRefUrl)
      }
      // Wired upstream images — use source node IDs as keys (matching frontend)
      const chainRefs = resolvedInputs.referenceImageUrls
        ?? (resolvedInputs.imageUrl ? [resolvedInputs.imageUrl] : undefined)
      if (chainRefs) {
        const imageSourceTypes = new Set(["upload-image", "generate-image", "edit-image", "image-to-image"])
        const wiredSourceIds = (buildCtx?.edges ?? [])
          .filter((e) => e.target === node.id)
          .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
          .filter((n): n is SimpleNode => !!n && imageSourceTypes.has(n.type))
          .map((n) => n.id)
        for (let i = 0; i < chainRefs.length; i++) {
          const key = wiredSourceIds[i] ?? `wired_${i}`
          refUrlMap.set(key, chainRefs[i])
        }
      }
      const extractedRefs = data.extractedReferenceUrls as string[] | undefined
      if (extractedRefs) {
        for (let i = 0; i < extractedRefs.length; i++) {
          refUrlMap.set(`extracted_${i}`, extractedRefs[i])
        }
      }
      // Character reference images
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      for (const c of charDefs) {
        if (c.type === "reference" && c.referenceImageUrl) {
          refUrlMap.set(`char_${c.id}`, c.referenceImageUrl)
        }
      }

      // Apply ordering: use referenceImageOrder if set, otherwise default map order
      const orderIds = (data.referenceImageOrder as string[]) ?? []
      const directRefs: string[] = []
      const seen = new Set<string>()
      for (const id of orderIds) {
        const url = refUrlMap.get(id)
        if (url) {
          directRefs.push(url)
          seen.add(id)
        }
      }
      for (const [id, url] of refUrlMap) {
        if (!seen.has(id)) directRefs.push(url)
      }

      // Ancestor refs fallback
      const ancestorRefs = directRefs.length === 0 && buildCtx?.nodes && buildCtx?.edges && buildCtx?.nodeStates
        ? collectAncestorRefs(node.id, buildCtx.nodes, buildCtx.edges, buildCtx.nodeStates)
        : []

      const rawPrompt = resolveRefs(resolvedInputs.prompt as string | undefined, refMap)
        || resolveRefs(data.prompt as string | undefined, refMap)
        || ""

      // Use shared prompt builder (single source of truth with frontend)
      const result = buildImagePrompt({
        prompt: rawPrompt,
        provider,
        style: typeof data.style === "string" ? data.style : undefined,
        negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
        characterDefs: charDefs as CharacterDef[],
        userTemplates: settings?.userPromptTemplates,
        flowTemplates: settings?.flowPromptTemplates,
        referenceImageUrls: directRefs,
        ancestorRefs,
      })

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(
          provider,
          data.quality as string | undefined,
          data.resolution as string | undefined,
          data.renderingSpeed as string | undefined,
        ),
        payload: {
          jobId,
          prompt: result.prompt,
          referenceImageUrls: result.referenceImageUrls,
          provider,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: result.nativeNegativePrompt,
          seed: data.seed,
          renderingSpeed: data.renderingSpeed,
          styleType: data.styleType,
          expandPrompt: data.expandPrompt,
          usageLogId,
        },
      }
    }

    case "edit-image": {
      const provider = (data.provider as string) ?? "recraft-upscale"

      // Apply connectedMediaOrder to determine main image vs references
      let mainImageUrl = resolvedInputs.imageUrl || data.imageUrl
      let editRefUrls: string[] | undefined
      const connectedOrder = data.connectedMediaOrder as string[] | undefined
      if (connectedOrder?.length && resolvedInputs.referenceImageUrls?.length) {
        const allNodes = buildCtx?.nodes ?? []
        const allEdges = buildCtx?.edges ?? []
        const states = buildCtx?.nodeStates ?? {}
        const sourceNodeIds = allEdges
          .filter((e) => e.target === node.id)
          .map((e) => e.source)
        const sourceNodes = sourceNodeIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter((n): n is SimpleNode => !!n)
        const ordered = applyOrder(sourceNodes, connectedOrder)
        const orderedUrls = ordered
          .map((n) => getNodeImageUrl(n, states))
          .filter((u): u is string => !!u)
        if (orderedUrls.length > 0) {
          mainImageUrl = orderedUrls[0]
          editRefUrls = orderedUrls.slice(1)
        }
      }

      let editPrompt = (resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)) as string | undefined
      if (provider === "nano-banana-edit" && editPrompt) {
        const charIds = (data.characterDefinitionIds as string[]) ?? []
        const charDefs = (buildCtx?.settings?.characterDefinitions ?? []).filter(
          (c: { id: string }) => charIds.includes(c.id),
        )
        if (charDefs.length > 0) {
          const descriptions = charDefs
            .map((c: { name: string; description?: string }) =>
              c.description ? `${c.name}: ${c.description}` : c.name,
            )
            .join("; ")
          editPrompt = `${editPrompt}\n\nContext: ${descriptions}`
        }
      }

      const targetResolution = data.targetResolution as string | undefined
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(provider, undefined, undefined, undefined, targetResolution),
        payload: {
          jobId,
          imageUrl: mainImageUrl,
          prompt: editPrompt,
          provider,
          upscaleFactor: data.upscaleFactor,
          targetResolution,
          aspectRatio: data.aspectRatio,
          negativePrompt: data.negativePrompt,
          style: data.style,
          seed: data.seed,
          referenceImageUrls: editRefUrls,
          usageLogId,
        },
      }
    }

    case "image-to-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings

      // Apply connectedMediaOrder to determine main image vs references
      let i2iMainImage = resolvedInputs.imageUrl || data.imageUrl
      let i2iChainRefs = resolvedInputs.referenceImageUrls ?? []
      const i2iOrder = data.connectedMediaOrder as string[] | undefined
      if (i2iOrder?.length && i2iChainRefs.length > 0) {
        const allNodes = buildCtx?.nodes ?? []
        const allEdges = buildCtx?.edges ?? []
        const states = buildCtx?.nodeStates ?? {}
        const srcIds = allEdges.filter((e) => e.target === node.id).map((e) => e.source)
        const srcNodes = srcIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter((n): n is SimpleNode => !!n)
        const ordered = applyOrder(srcNodes, i2iOrder)
        const orderedUrls = ordered
          .map((n) => getNodeImageUrl(n, states))
          .filter((u): u is string => !!u)
        if (orderedUrls.length > 0) {
          i2iMainImage = orderedUrls[0]
          i2iChainRefs = orderedUrls.slice(1)
        }
      }

      // Collect reference images from character assets
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      const charRefUrls = charDefs
        .filter((c) => c.type === "reference" && c.referenceImageUrl)
        .map((c) => c.referenceImageUrl as string)
      const nodeRefUrl = data.referenceImageUrl as string | undefined
      const directRefs = [
        ...(nodeRefUrl ? [nodeRefUrl] : []),
        ...i2iChainRefs,
        ...charRefUrls,
      ]

      const rawPrompt = resolveRefs(resolvedInputs.prompt as string | undefined, refMap)
        || resolveRefs(data.prompt as string | undefined, refMap)
        || ""

      // Build prompt with style + character descriptions (same as generate-image)
      const i2iResult = buildImagePrompt({
        prompt: rawPrompt,
        provider,
        style: typeof data.style === "string" ? data.style : undefined,
        negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
        characterDefs: charDefs as CharacterDef[],
        userTemplates: settings?.userPromptTemplates,
        flowTemplates: settings?.flowPromptTemplates,
        referenceImageUrls: directRefs,
        ancestorRefs: [],
      })

      return {
        jobName: "image-to-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(
          provider,
          data.quality as string | undefined,
          data.resolution as string | undefined,
          data.renderingSpeed as string | undefined,
        ),
        payload: {
          jobId,
          imageUrl: i2iMainImage,
          prompt: i2iResult.prompt,
          referenceImageUrls: i2iResult.referenceImageUrls,
          provider,
          strength: data.strength,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: i2iResult.nativeNegativePrompt,
          seed: data.seed,
          renderingSpeed: data.renderingSpeed,
          guidanceScale: data.guidanceScale,
          maskUrl: resolvedInputs.maskUrl || (data.maskUrl as string | undefined),
          usageLogId,
        },
      }
    }

    // --- Video generation ---
    case "image-to-video": {
      const provider = (data.provider as string) ?? "kling"
      return {
        jobName: "image-to-video",
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          provider,
          data.duration as number | string | undefined,
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          undefined,
          (data.videoSize as string | undefined) ?? (data.mode ?? data.kling3Mode) as string | undefined,
        ),
        payload: {
          jobId,
          imageUrl: resolvedInputs.startFrameUrl || resolvedInputs.imageUrl || data.imageUrl,
          endFrameUrl: resolvedInputs.endFrameUrl,
          audioUrl: resolvedInputs.audioUrl,
          prompt: (() => {
            let p = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || resolveRefs(data.motionPrompt as string | undefined, refMap)
            const hints: string[] = []
            if (data.motionEnabled && data.motion) hints.push(`${data.motion} motion`)
            if (data.cameraMotionEnabled && data.cameraMotion && data.cameraMotion !== "static") hints.push(`camera: ${String(data.cameraMotion).replace("-", " ")}`)
            if (hints.length > 0 && p) p = `${p}. ${hints.join(", ")}`
            else if (hints.length > 0) p = hints.join(", ")
            return p
          })(),
          provider,
          duration: data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          generateAudio: data.generateAudio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          grokMode: data.grokMode,
          videoSize: data.videoSize,
          removeWatermark: data.removeWatermark,
          characterIdList: resolvedInputs.characterIdList,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          generationType: data.veoMode === "reference" ? "REFERENCE_2_VIDEO" : undefined,
          usageLogId,
        },
      }
    }

    case "text-to-video": {
      const provider = (data.provider as string) ?? "kling"
      return {
        jobName: "text-to-video",
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          provider,
          data.duration as number | string | undefined,
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          "text-to-video",
          (data.mode ?? data.kling3Mode ?? data.videoSize) as string | undefined,
        ),
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          provider,
          duration: data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          aspectRatio: data.aspectRatio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          removeWatermark: data.removeWatermark,
          seed: data.seed,
          usageLogId,
        },
      }
    }

    case "video-to-video": {
      const v2vProvider = (data.provider as string) ?? "wan"
      return {
        jobName: "video-to-video",
        queueName: "video-generation",
        modelIdentifier: v2vProvider,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          provider: v2vProvider,
          duration: data.v2vDuration as string | undefined,
          resolution: data.v2vResolution as string | undefined,
          audio: data.audio as boolean | undefined,
          multiShots: data.multiShots as boolean | undefined,
          aspectRatio: data.aspectRatio as string | undefined,
          seed: data.seed as number | undefined,
          referenceImageUrl: (typeof resolvedInputs.referenceImageUrls === "string" ? resolvedInputs.referenceImageUrls : Array.isArray(resolvedInputs.referenceImageUrls) ? resolvedInputs.referenceImageUrls[0] : undefined) as string | undefined,
          usageLogId,
        },
      }
    }

    case "lip-sync": {
      const provider = (data.provider as string) ?? "kling-avatar"
      return {
        jobName: "lip-sync",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || resolvedInputs.videoUrl || data.imageUrl || data.videoUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          prompt: resolvedInputs.prompt || data.prompt || "A person talking naturally",
          provider,
          resolution: data.resolution,
          usageLogId,
        },
      }
    }

    case "speech-to-video": {
      const s2vResolution = (data.resolution as string) ?? "480p"
      const s2vModelId = s2vResolution === "720p"
        ? "speech-to-video:720p"
        : s2vResolution === "580p"
          ? "speech-to-video:580p"
          : "speech-to-video"
      return {
        jobName: "speech-to-video",
        queueName: "video-generation",
        modelIdentifier: s2vModelId,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          prompt: resolvedInputs.prompt || data.prompt,
          resolution: s2vResolution,
          negativePrompt: data.negativePrompt,
          seed: data.seed,
          numFrames: data.numFrames,
          fps: data.fps,
          inferenceSteps: data.inferenceSteps,
          guidanceScale: data.guidanceScale,
          shift: data.shift,
          usageLogId,
        },
      }
    }

    case "sora-storyboard": {
      const sbNFrames = (data.nFrames as string) ?? "10"
      const sbModelId = sbNFrames === "10" ? "sora-storyboard" : "sora-storyboard:15"
      // Collect image URLs from resolved inputs if available
      const sbImageUrls: string[] = []
      if (resolvedInputs.imageUrl) sbImageUrls.push(resolvedInputs.imageUrl)
      if (resolvedInputs.referenceImageUrls) sbImageUrls.push(...resolvedInputs.referenceImageUrls)

      // Auto-fill shots from connected generate-script if shots are empty
      let sbShots = data.shots as Array<{ scene: string; duration: number }> | undefined
      if (resolvedInputs.scriptData && (!sbShots || !sbShots.some((s: { scene: string }) => s.scene?.trim()?.length > 0))) {
        const script = resolvedInputs.scriptData as { scenes?: Array<{ visualDescription?: string; durationHint?: number }> }
        if (script.scenes && script.scenes.length > 0) {
          sbShots = script.scenes.slice(0, 10).map((scene) => ({
            scene: buildEnrichedScenePrompt(scene as EnrichableScene),
            duration: Math.max(1, Math.min(10, scene.durationHint ?? 5)),
          }))
        }
      }

      return {
        jobName: "sora-storyboard",
        queueName: "video-generation",
        modelIdentifier: sbModelId,
        payload: {
          jobId,
          shots: sbShots ?? data.shots,
          nFrames: sbNFrames,
          imageUrls: sbImageUrls.length > 0 ? sbImageUrls.slice(0, 5) : (data.imageUrls ?? undefined),
          aspectRatio: data.aspectRatio ?? "landscape",
          usageLogId,
        },
      }
    }

    case "sora-character": {
      return {
        jobName: "sora-character",
        queueName: "video-generation",
        modelIdentifier: "sora-character",
        payload: {
          jobId,
          mode: data.mode,
          characterPrompt: data.characterPrompt,
          characterName: data.characterName,
          timestamps: data.timestamps,
          safetyInstruction: data.safetyInstruction,
          videoUrl: resolvedInputs.videoUrl || (data.videoUrl as string | undefined),
          kieTaskId: resolvedInputs.kieTaskId || (data.kieTaskId as string | undefined),
          usageLogId,
        },
      }
    }

    case "motion-transfer": {
      const mtProvider = (data.provider as string) ?? "kling"
      const mtResolution = (data.resolution as string) ?? "720p"
      const mtVideoDuration = data.videoDuration as number | undefined
      const mtModelId = buildMotionCreditModelIdentifier(mtProvider, mtResolution, mtVideoDuration)
      return {
        jobName: "motion-transfer",
        queueName: "video-generation",
        modelIdentifier: mtModelId,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          provider: mtProvider,
          backgroundSource: data.backgroundSource,
          characterOrientation: data.characterOrientation,
          resolution: mtResolution,
          videoDuration: mtVideoDuration,
          usageLogId,
        },
      }
    }

    case "video-upscale": {
      const vuProvider = (data.provider as string) ?? "topaz"
      const vuModel = vuProvider === "veo-1080p" ? "veo-1080p"
        : vuProvider === "veo-4k" ? "veo-4k"
        : "topaz-video"
      return {
        jobName: "video-upscale",
        queueName: "video-generation",
        modelIdentifier: vuModel,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          upscaleFactor: data.upscaleFactor,
          provider: vuProvider,
          kieTaskId: resolvedInputs.kieTaskId || data.kieTaskId,
          usageLogId,
        },
      }
    }

    case "extend-video": {
      const evProvider = (data.provider as string) ?? "veo-extend"
      const evModel = evProvider === "veo-extend"
        ? (evProvider + (data.model === "quality" ? ":quality" : ""))
        : evProvider
      return {
        jobName: "extend-video",
        queueName: "video-generation",
        modelIdentifier: evModel,
        payload: {
          jobId,
          kieTaskId: resolvedInputs.kieTaskId || data.kieTaskId,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          provider: evProvider,
          model: evProvider === "veo-extend" ? (data.model ?? "fast") : undefined,
          quality: evProvider === "runway-extend" ? (data.quality ?? "720p") : undefined,
          seeds: evProvider === "veo-extend" ? data.seeds : undefined,
          usageLogId,
        },
      }
    }

    // --- Audio ---
    case "text-to-speech": {
      const provider = (data.provider as string) ?? "elevenlabs-v3"
      // Frontend reads text from directText field when textSource is "direct"
      const ttsText = resolvedInputs.prompt
        || (data.textSource === "direct" ? resolveRefs(data.directText as string | undefined, refMap) : undefined)
        || resolveRefs(data.text as string | undefined, refMap)
      return {
        jobName: "text-to-speech",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          text: ttsText,
          voice: data.voiceId || data.voice,
          provider,
          voiceType: data.voiceType || "premade",
          stability: data.stability,
          similarityBoost: data.similarityBoost,
          style: data.style,
          speed: data.speed,
          languageCode: data.languageCode,
          usageLogId,
        },
      }
    }

    case "generate-music": {
      const provider = (data.provider as string) ?? "musicgen"
      return {
        jobName: "generate-music",
        queueName: "video-generation",
        modelIdentifier: "generate-music",
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          provider,
          duration: data.duration,
          genre: data.genre,
          mood: data.mood,
          instrumental: data.instrumental,
          lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
          referenceAudioUrl: resolvedInputs.audioUrl || data.referenceAudioUrl,
          usageLogId,
        },
      }
    }

    case "text-to-audio": {
      const t2aProvider = (data.provider as string) ?? "elevenlabs-sfx"
      return simpleResult("text-to-audio", "elevenlabs-sfx", {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || resolveRefs(data.text as string | undefined, refMap),
        provider: t2aProvider,
        duration: data.duration,
        // Only send SFX-specific options for elevenlabs-sfx (matches frontend)
        ...(t2aProvider === "elevenlabs-sfx" ? {
          loop: data.loop,
          promptInfluence: data.promptInfluence,
        } : {}),
        usageLogId,
      })
    }

    case "audio-isolation":
      return simpleResult("audio-isolation", "elevenlabs-isolation", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        usageLogId,
      })

    case "text-to-dialogue": {
      // Filter empty dialogue lines (matches frontend behavior)
      const rawDialogue = (data.dialogue ?? data.script) as Array<{ text: string; voice?: string }> | undefined
      const filteredDialogue = rawDialogue?.filter((l) => l.text?.trim())
      return simpleResult("text-to-dialogue", "elevenlabs-dialogue", {
        jobId,
        dialogue: filteredDialogue,
        stability: data.stability,
        languageCode: data.languageCode,
        usageLogId,
      })
    }

    case "voice-changer":
      return simpleResult("voice-changer", "elevenlabs-voice-changer", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        voiceId: data.voiceId || data.voice,
        stability: data.stability,
        similarityBoost: data.similarityBoost,
        removeBackgroundNoise: data.removeBackgroundNoise,
        usageLogId,
      })

    case "dubbing":
      return simpleResult("dubbing", "elevenlabs-dubbing", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        targetLanguage: data.targetLanguage,
        sourceLanguage: data.sourceLanguage,
        numSpeakers: data.numSpeakers,
        usageLogId,
      })

    case "voice-remix":
      return simpleResult("voice-remix", "elevenlabs-voice-remix", {
        jobId,
        voiceDescription: data.voiceDescription,
        text: resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap),
        usageLogId,
      })

    case "voice-design":
      return simpleResult("voice-design", "elevenlabs-voice-design", {
        jobId,
        text: resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap),
        voiceDescription: data.voiceDescription,
        model: data.model,
        loudness: data.loudness,
        guidanceScale: data.guidanceScale,
        seed: data.seed,
        quality: data.quality,
        shouldEnhance: data.shouldEnhance,
        usageLogId,
      })

    case "forced-alignment":
      return simpleResult("forced-alignment", "elevenlabs-forced-alignment", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        transcript: resolvedInputs.prompt || resolveRefs(data.transcript as string | undefined, refMap),
        usageLogId,
      })

    // --- Suno ---
    case "suno-generate": {
      const hasCustomFields = !!(data.style || data.title || data.lyrics)
      const sunoGenCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-generate"
      return simpleResult("suno-generate", sunoGenCreditId, {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        model: data.model,
        lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
        customMode: data.customMode ?? hasCustomFields,
        instrumental: data.instrumental ?? false,
        usageLogId,
      })
    }

    case "suno-cover": {
      const hasCoverCustomFields = !!(data.style || data.title || data.lyrics)
      const sunoCoverCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-cover"
      return simpleResult("suno-cover", sunoCoverCreditId, {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        uploadUrl: resolvedInputs.uploadUrl || resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl,
        model: data.model,
        lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        customMode: data.customMode ?? hasCoverCustomFields,
        instrumental: data.instrumental ?? false,
        usageLogId,
      })
    }

    case "suno-extend": {
      const sunoExtCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-extend"
      return simpleResult("suno-extend", sunoExtCreditId, {
        jobId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        defaultParamFlag: data.defaultParamFlag ?? true,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        model: data.model,
        style: data.style,
        title: data.title,
        continueAt: data.continueAt ?? data.continueFrom,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
        usageLogId,
      })
    }

    case "suno-lyrics":
      return simpleResult("suno-lyrics", "suno-lyrics", {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        usageLogId,
      })

    case "suno-separate":
      return simpleResult("suno-separate", "suno-separate", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        type: data.type || "separate_vocal",
        usageLogId,
      })

    case "suno-music-video":
      return simpleResult("suno-music-video", "suno-music-video", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        usageLogId,
      })

    case "suno-mashup":
      return simpleResult("suno-mashup", "suno-mashup", {
        jobId,
        uploadUrlList: resolvedInputs.uploadUrlList || [
          resolvedInputs.audioUrl,
          resolvedInputs.audioUrl2,
        ].filter(Boolean),
        model: data.model,
        customMode: data.customMode ?? false,
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        usageLogId,
      })

    case "suno-replace-section":
      return simpleResult("suno-replace-section", "suno-replace-section", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        infillStartS: data.infillStartS ?? 0,
        infillEndS: data.infillEndS ?? 30,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        tags: data.tags,
        title: data.title,
        usageLogId,
      })

    case "suno-add-instrumental":
      return simpleResult("suno-add-instrumental", "suno-add-instrumental", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        model: data.model,
        usageLogId,
      })

    case "suno-add-vocals":
      return simpleResult("suno-add-vocals", "suno-add-vocals", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        model: data.model,
        usageLogId,
      })

    case "suno-convert-wav":
      return simpleResult("suno-convert-wav", "suno-convert-wav", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        usageLogId,
      })

    case "suno-upload-extend":
      return simpleResult("suno-upload-extend", "suno-upload-extend", {
        jobId,
        uploadUrl: resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl,
        prompt: resolveRefs(data.prompt as string | undefined, refMap),
        continueAt: data.continueAt,
        defaultParamFlag: data.defaultParamFlag ?? true,
        model: data.model,
        style: resolvedInputs.prompt || data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        usageLogId,
      })

    // --- Transcription / OCR ---
    case "transcribe": {
      const provider = (data.provider as string) ?? "elevenlabs-stt"
      let transcribeAudioUrl = resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl

      // If the audio source is a youtube-video node, prefer its downloadedAudioUrl
      // (matches frontend logic that calls downloadYouTubeAudio before transcribing)
      if (buildCtx?.edges && buildCtx?.nodes && buildCtx?.nodeStates) {
        const transcribeInEdges = buildCtx.edges.filter((e) => e.target === node.id)
        for (const edge of transcribeInEdges) {
          const srcNode = buildCtx.nodes.find((n) => n.id === edge.source)
          if (!srcNode || srcNode.type !== "youtube-video") continue
          const ytAudio = (srcNode.data.downloadedAudioUrl as string | undefined)?.trim()
          if (ytAudio) {
            transcribeAudioUrl = ytAudio
            break
          }
        }
      }

      return {
        jobName: "transcribe",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          audioUrl: transcribeAudioUrl,
          provider,
          language: data.language,
          diarize: data.diarize,
          tagAudioEvents: data.tagAudioEvents,
          usageLogId,
        },
      }
    }

    // --- FFmpeg processing (0 credits) ---
    case "combine-videos": {
      let combineVideoUrls = resolvedInputs.videoUrls || data.videoUrls || []
      // Apply user-configured clip ordering if available (matches frontend logic)
      const clipOrder = data.clipOrder as string[] | undefined
      if (clipOrder?.length && resolvedInputs.videoUrlsWithSourceIds?.length) {
        const ordered: string[] = []
        for (const nodeId of clipOrder) {
          const entry = resolvedInputs.videoUrlsWithSourceIds.find((e) => e.nodeId === nodeId)
          if (entry) ordered.push(entry.url)
        }
        if (ordered.length >= 2) combineVideoUrls = ordered
      }
      return ffmpegResult("combine-videos", {
        jobId,
        videoUrls: combineVideoUrls,
        transition: data.transition ?? "cut",
        transitionDuration: data.transitionDuration ?? 0.5,
        audioMode: data.audioMode ?? "crossfade",
        trimStartFrames: (data.trimStartFrames as number) ?? 0,
        trimEndFrames: (data.trimEndFrames as number) ?? 0,
        usageLogId,
      })
    }

    case "merge-video-audio": {
      // Build audioTracks from resolved audioSources (matches frontend mergeVideoAudioApi shape)
      const trackSettings = (data.trackSettings as Record<string, Record<string, unknown>> | undefined) ?? {}
      const voiceoverVol = (data.voiceoverVolume as number | undefined) ?? 100
      const audioTracks = (resolvedInputs.audioSources ?? []).map((s) => {
        const settings = trackSettings[s.sourceNodeId]
        return {
          url: s.url,
          startTime: (settings?.startTime as number | undefined) ?? 0,
          volume: (settings?.volume as number | undefined) ?? voiceoverVol,
          sourceType: s.sourceType ?? (settings?.sourceType as "audio" | "video" | undefined),
        }
      })
      // If only a single audioUrl was resolved (no audioSources), add it as a track
      if (audioTracks.length === 0 && resolvedInputs.audioUrl) {
        audioTracks.push({
          url: resolvedInputs.audioUrl,
          startTime: 0,
          volume: voiceoverVol,
          sourceType: "audio" as const,
        })
      }
      return ffmpegResult("merge-video-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioTracks,
        voiceoverVolume: voiceoverVol,
        backgroundVolume: (data.originalAudioVolume as number | undefined) ?? (data.backgroundVolume as number | undefined) ?? 30,
        keepOriginalAudio: data.keepOriginalAudio ?? true,
        usageLogId,
      })
    }

    case "trim-audio":
      return ffmpegResult("trim-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || resolvedInputs.audioUrl || data.videoUrl,
        audioFormat: data.audioFormat,
        startTime: data.startTime,
        endTime: data.endTime,
        usageLogId,
      })

    case "split-media":
      return ffmpegResult("split-media", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        chunkDuration: data.chunkDuration,
        audioFormat: data.audioFormat,
        usageLogId,
      })

    case "trim-video":
      return ffmpegResult("trim-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        startTime: data.startTime,
        endTime: data.endTime,
        usageLogId,
      })

    case "extract-frame":
      return ffmpegResult("extract-frame", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        mode: data.mode || "first",
        timestamp: data.timestamp,
        usageLogId,
      })

    case "resize-video":
      return ffmpegResult("resize-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        targetAspect: data.targetAspect ?? data.aspectRatio,
        method: data.method ?? "fit",
        padColor: data.padColor,
        usageLogId,
      })

    case "social-media-format": {
      const mediaUrl = resolvedInputs.videoUrl || resolvedInputs.imageUrl || data.mediaUrl
      const mediaType = resolvedInputs.videoUrl ? "video" : "image"
      const specKey = (data.specKey as string) || "instagram:feed-square"
      const spec = PLATFORM_SPECS[specKey]
      return ffmpegResult("social-media-format", {
        jobId,
        mediaUrl,
        mediaType,
        specKey,
        width: spec?.width ?? 1080,
        height: spec?.height ?? 1080,
        method: data.method || "pad",
        padColor: data.padColor || "#000000",
        usageLogId,
      })
    }

    case "speed-ramp":
      return ffmpegResult("speed-ramp", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        speed: data.speed,
        adjustAudio: data.adjustAudio,
        usageLogId,
      })

    case "loop-video":
      return ffmpegResult("loop-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        mode: data.mode ?? "repeat",
        repeatCount: data.repeatCount ?? data.loops,
        targetDuration: data.targetDuration,
        usageLogId,
      })

    case "fade-video":
      return ffmpegResult("fade-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        fadeIn: data.fadeIn ?? true,
        fadeInDuration: data.fadeInDuration ?? 0.5,
        fadeOut: data.fadeOut ?? true,
        fadeOutDuration: data.fadeOutDuration ?? 0.5,
        color: data.color ?? "black",
        usageLogId,
      })

    case "transcode-video":
      return ffmpegResult("transcode-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        codec: data.codec,
        crf: data.crf,
        resolution: data.resolution,
        audioBitrate: data.audioBitrate,
        usageLogId,
      })

    case "add-captions":
      return ffmpegResult("add-captions", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        text: resolvedInputs.prompt || resolveRefs(data.captions as string | undefined, refMap) || resolveRefs(data.text as string | undefined, refMap),
        style: data.captionStyle ?? data.style,
        position: data.captionPosition ?? data.position,
        fontSize: data.fontSize,
        color: data.color,
        backgroundColor: data.backgroundColor,
        usageLogId,
      })

    case "mix-audio": {
      let mixAudioUrls = resolvedInputs.audioUrls || data.audioUrls || []
      // Apply user-configured track ordering if available (matches frontend logic)
      const trackOrder = data.trackOrder as string[] | undefined
      if (trackOrder?.length && resolvedInputs.audioUrlsWithSourceIds?.length) {
        const ordered: string[] = []
        for (const nodeId of trackOrder) {
          const entry = resolvedInputs.audioUrlsWithSourceIds.find((e) => e.nodeId === nodeId)
          if (entry) ordered.push(entry.url)
        }
        if (ordered.length >= 2) mixAudioUrls = ordered
      }
      return ffmpegResult("mix-audio", {
        jobId,
        audioUrls: mixAudioUrls,
        trackVolumes: data.trackVolumes ?? data.volumes,
        usageLogId,
      })
    }

    case "adjust-volume": {
      const avInputUrl = resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl || data.videoUrl
      const avVideoUrl = resolvedInputs.videoUrl || data.videoUrl
      return ffmpegResult("adjust-volume", {
        jobId,
        audioUrl: avInputUrl,
        videoUrl: avVideoUrl,
        volume: data.volume,
        normalize: data.normalize,
        fadeIn: data.fadeIn,
        fadeOut: data.fadeOut,
        usageLogId,
      })
    }

    // --- Entity generation (character, face, object, location share identical structure) ---
    case "character":
    case "face":
    case "object":
    case "location": {
      const provider = (data.provider as string) ?? "nano-banana"
      return {
        jobName: `generate-${type}`,
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: resolveRefs(data.description as string | undefined, refMap) || resolveRefs(data.prompt as string | undefined, refMap),
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }

    case "scene": {
      const provider = (data.provider as string) ?? "nano-banana"
      const sceneSettings = buildCtx?.settings
      const charDefs = sceneSettings?.characterDefinitions ?? []
      const userTpl = sceneSettings?.userPromptTemplates
      const flowTpl = sceneSettings?.flowPromptTemplates

      // Build the rich scene prompt (matches frontend execute-node.ts logic).
      // Wrapped in try/catch because node data is cast from Record<string, unknown>
      // and may be missing required SceneData fields on older/malformed nodes.
      let scenePrompt: string
      const sceneRefUrls = [...(resolvedInputs.referenceImageUrls ?? [])]
      try {
        const sceneStylePrompt = buildScenePrompt(data as unknown as SceneData, charDefs as CharacterDef[])
        const upstreamPrompt = resolvedInputs.prompt ?? ""
        scenePrompt = upstreamPrompt
          ? `${upstreamPrompt}. ${sceneStylePrompt}`
          : sceneStylePrompt

        // Append character description templates (matches frontend charDescs logic).
        // buildScenePrompt adds compositional info (name + mood + action);
        // this loop adds full description text via templates for the image generator.
        const allAssetIds = [
          ...((data.characters as Array<{ assetId: string }>) ?? []).map((c) => c.assetId),
          ...((data.locations as Array<{ assetId: string }>) ?? []).map((l) => l.assetId),
          ...((data.objects as Array<{ assetId: string }>) ?? []).map((o) => o.assetId),
        ].filter(Boolean)
        const sceneCharDescs: string[] = []
        for (const assetId of allAssetIds) {
          const asset = charDefs.find((a) => a.id === assetId)
          if (!asset) continue
          if (asset.referenceImageUrl) sceneRefUrls.push(asset.referenceImageUrl)
          if (asset.type === "description" && asset.description) {
            const templateKey =
              asset.category === "face" ? "face-description"
                : asset.category === "location" ? "location-description"
                  : asset.category === "object" ? "object-description"
                    : "character-description"
            const template = resolveTemplate(templateKey, userTpl, flowTpl)
            sceneCharDescs.push(applyTemplate(template, { name: asset.name, description: asset.description }))
          }
        }
        if (sceneCharDescs.length > 0) {
          scenePrompt = `${scenePrompt}\n${sceneCharDescs.join(" ")}`
        }
      } catch {
        // Malformed scene data — fall back to raw prompt fields
        scenePrompt = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || ""
      }

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: scenePrompt,
          provider,
          referenceImageUrls: sceneRefUrls.length > 0 ? sceneRefUrls : undefined,
          aspectRatio: data.aspectRatio,
          usageLogId,
        },
      }
    }

    case "generate-script":
      return simpleResult("generate-script", "generate-script", {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        sceneCount: data.sceneCount,
        tone: data.tone ?? data.style,
        targetDuration: data.targetDuration ?? data.targetLength,
        provider: data.provider,
        usageLogId,
      })

    // --- Render video (goes to render queue) ---
    case "render-video": {
      // Resolve plan from upstream composer nodes (matches frontend execute-node.ts logic)
      let resolvedPlanType = data.planType as string | undefined
      let resolvedPlan = data.plan as Record<string, unknown> | undefined
      let resolvedSceneGraph = data.sceneGraph as Record<string, unknown> | undefined

      // Search upstream nodes for plan output (matches frontend logic)
      if (!resolvedPlan && !resolvedSceneGraph && buildCtx?.edges && buildCtx?.nodes && buildCtx?.nodeStates) {
        const incomingEdges = buildCtx.edges.filter((e) => e.target === node.id)
        for (const edge of incomingEdges) {
          const srcNode = buildCtx.nodes.find((n) => n.id === edge.source)
          if (!srcNode) continue
          const mapping = COMPOSER_PLAN_MAP[srcNode.type]
          if (!mapping) continue
          // Check execution state output first (current run), then saved node data
          const foundPlan =
            (buildCtx.nodeStates?.[srcNode.id]?.output?.plan as Record<string, unknown> | undefined) ??
            (srcNode.data[mapping.planField] as Record<string, unknown> | undefined)
          if (foundPlan) {
            resolvedPlanType = mapping.planType
            if (mapping.planType === "scene-graph") {
              resolvedSceneGraph = foundPlan
            } else {
              resolvedPlan = foundPlan
            }
            break
          }
        }

        // Auto-composition fallback: if no plan found, collect media assets and
        // build a simple scene graph (matches frontend buildAutoComposition)
        if (!resolvedPlan && !resolvedSceneGraph) {
          const assets = collectMediaAssetsForRender(node, buildCtx.edges, buildCtx.nodes, buildCtx.nodeStates)
          if (assets.length > 0) {
            const renderFps = (data.fps as number) ?? 30
            const renderDuration = (data.durationSeconds as number) ?? 10
            const renderAspect = (data.aspectRatio as string) ?? "16:9"
            const renderBg = (data.backgroundColor as string) ?? "#000000"
            resolvedSceneGraph = buildAutoCompositionForRender(assets, renderFps, renderDuration, renderAspect, renderBg)
          }
        }
      }

      return {
        jobName: "render-video",
        queueName: "video-render",
        modelIdentifier: "render-video",
        payload: {
          jobId,
          planType: resolvedPlanType,
          plan: resolvedPlan,
          sceneGraph: resolvedSceneGraph,
          template: data.template,
          usageLogId,
        },
      }
    }

    default:
      throw new Error(`[payload-builder] Unknown node type: ${type}`)
  }
}

// ---------------------------------------------------------------------------
// Auto-composition helpers for render-video fallback (matches frontend)
// ---------------------------------------------------------------------------

/** Collect image/video/audio assets from upstream nodes (matches frontend collectMediaAssets). */
function collectMediaAssetsForRender(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): Array<{ id: string; type: "image" | "video" | "audio"; url: string }> {
  const assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string }> = []
  const seen = new Set<string>()
  const incomingEdges = edges.filter((e) => e.target === node.id)

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const srcType = srcNode.type
    // Skip plan nodes — they're handled by the plan resolution path
    if (COMPOSER_PLAN_MAP[srcType]) continue

    let output: string | undefined
    const state = nodeStates[srcNode.id]
    if (state?.output) {
      output = getPrimaryOutput(state.output, srcType, edge.sourceHandle)
    } else if (isSourceNode(srcType)) {
      const srcOutput = extractSourceNodeOutput(srcNode)
      if (srcOutput) output = getPrimaryOutput(srcOutput, srcType, edge.sourceHandle)
    }
    if (!output || output === "plan-ready" || seen.has(srcNode.id)) continue
    seen.add(srcNode.id)

    let assetType: "image" | "video" | "audio" | undefined
    if (IMAGE_SOURCE_TYPES.has(srcType)) assetType = "image"
    else if (VIDEO_SOURCE_TYPES.has(srcType)) assetType = "video"
    else if (AUDIO_SOURCE_TYPES.has(srcType)) assetType = "audio"

    if (assetType) {
      assets.push({ id: srcNode.id, type: assetType, url: output })
    }
  }

  return assets
}

/** Build a simple scene graph from media assets (matches frontend buildAutoComposition). */
function buildAutoCompositionForRender(
  assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string }>,
  fps: number,
  totalDuration: number,
  aspectRatio: string,
  backgroundColor: string,
): Record<string, unknown> {
  const visualAssets = assets.filter((a) => a.type !== "audio")
  const audioAssets = assets.filter((a) => a.type === "audio")

  const perAssetDuration = visualAssets.length > 0 ? totalDuration / visualAssets.length : totalDuration
  const perAssetFrames = Math.round(perAssetDuration * fps)
  const transitionFrames = 15
  const lastIndex = Math.max(visualAssets.length - 1, 0)

  const tracks: unknown[] = []

  if (visualAssets.length > 0) {
    const mediaSegments = visualAssets.map((asset, i) => ({
      id: `seg_${i}`,
      src: asset.url,
      mediaType: asset.type as "image" | "video",
      startFrame: i * perAssetFrames,
      durationInFrames: perAssetFrames,
      layout: { mode: "fullscreen" as const },
      transitionIn: i > 0 ? { type: "fade", durationFrames: transitionFrames } : undefined,
      transitionOut: i < lastIndex ? { type: "fade", durationFrames: transitionFrames } : undefined,
      effects: asset.type === "image" ? [{ type: "ken-burns", startValue: 1.0, endValue: 1.1 }] : [],
    }))
    tracks.push({
      id: "track_media",
      type: "media",
      zIndex: 0,
      segments: mediaSegments,
    })
  }

  for (let i = 0; i < audioAssets.length; i++) {
    tracks.push({
      id: `track_audio_${i}`,
      type: "audio",
      src: audioAssets[i].url,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      startFrame: 0,
    })
  }

  const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["16:9"]

  return {
    fps,
    width: dimensions.width,
    height: dimensions.height,
    durationInFrames: Math.round(totalDuration * fps),
    backgroundColor,
    tracks,
  }
}
