/**
 * What both halves of Clip Pack's builder share (the one-recording chain in
 * clip-pack-graph.ts, the several-recordings chain in clip-pack-multicam.ts):
 * the built node ids, the plan and render steps, and the tail every pack ends
 * with — captions on each clip and the output map. A leaf (it imports neither
 * half), so the two halves never load each other in a loop. Pure.
 */
import type { ClipsOutputMap, UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef } from "./use-case-graph"
import { usecaseEdge, usecaseNode } from "./use-case-graph-parts"
import { usecaseTypeOfBuilder } from "./use-case-rows"
import type { ClipPackFraming, ClipPackGraph, ClipPackSettings } from "./clip-pack-graph"

export const CLIP_PACK_NODE_IDS = Object.freeze({
  source: "uc-source",
  transcribe: "uc-transcribe",
  plan: "uc-plan",
  render: "uc-render",
  captions: "uc-captions",
} as const)

/** The render step: the shipped Speaker View node when framed, else Apply EDL (the template's). */
export const CLIP_PACK_FRAMED_RENDER_TYPE = "speaker-view"
export const CLIP_PACK_RENDER_TYPE = "apply-edl"

const ID = CLIP_PACK_NODE_IDS

/** Edit Plan in clips mode over these recordings (the one recording alone, or every camera with its role). */
export function clipPackPlanNode(
  settings: ClipPackSettings,
  framing: ClipPackFraming | null,
  sourceOrder: readonly string[],
  sourceConfig: Readonly<Record<string, unknown>>,
): UseCaseGraphNode {
  return usecaseNode(ID.plan, "edit-plan", 2, 1, {
    label: "Find Clips", mode: "clips", planTier: settings.planTier, count: settings.count, targetDurationSec: settings.targetDurationSec,
    ...(framing ? { targetAspect: framing.aspect } : {}),
    instructions: settings.instructions,
    ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
    sourceOrder: [...sourceOrder], sourceConfig: { ...sourceConfig },
  })
}

/** The per-clip render: Speaker View on automatic boxes when framed, else Apply EDL at the recordings' shape. */
export function clipPackRenderNode(settings: ClipPackSettings, framing: ClipPackFraming | null, output: "video" | "audio", column: number): UseCaseGraphNode {
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  return framing
    ? usecaseNode(ID.render, CLIP_PACK_FRAMED_RENDER_TYPE, column, 1, {
        label: "Render Clip", quality, targetAspect: framing.aspect, layout: framing.layout,
        switchType: framing.switchType, emphasisStyle: framing.emphasisStyle, autoRegions: true,
      })
    : usecaseNode(ID.render, CLIP_PACK_RENDER_TYPE, column, 1, { label: "Render Clip", output, quality, crossfadeMs: 0 })
}

/** The chain up to and including the render. */
export interface ClipPackChainHead {
  readonly nodes: UseCaseGraphNode[]
  readonly edges: UseCaseGraphEdge[]
  readonly framed: boolean
  /** An audio pack: no captions. */
  readonly audio: boolean
  readonly renderColumn: number
  /** A multicam run's Audio Sync and Speaker Map (the output map names them only when given). */
  readonly multicam?: ClipsOutputMap["multicam"]
}

/**
 * The tail every pack ends with, after its per-clip render: captions on each
 * clip (an Each wire: one per clip, on its own transcription) and the output
 * map. Appends to `head`'s own arrays.
 */
export function withClipPackTail(settings: ClipPackSettings, head: ClipPackChainHead): ClipPackGraph {
  const { nodes, edges } = head
  const renderMedia = head.framed ? "video" : "media"
  let media: UseCaseHandleRef = { nodeId: ID.render, handle: renderMedia }
  if (!head.audio && settings.captions) {
    nodes.push(usecaseNode(ID.captions, "add-captions", head.renderColumn + 1, 1, {
      label: "Caption Clip", style: settings.captionStyle, wordLevel: true, autoTranscribe: true, position: "bottom", fontSize: 28, color: "#ffffff",
    }))
    // Each clip is captioned on its own: the wire reads the renders one by one.
    edges.push(usecaseEdge(ID.render, renderMedia, ID.captions, "in", true))
    media = { nodeId: ID.captions, handle: "video-out" }
  }
  return {
    nodeType: usecaseTypeOfBuilder("clipPack"),
    nodes,
    edges,
    outputMap: {
      kind: "clips",
      media,
      preview: { nodeId: ID.render, handle: renderMedia },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
      ...(head.multicam ? { multicam: head.multicam } : {}),
    },
  }
}
