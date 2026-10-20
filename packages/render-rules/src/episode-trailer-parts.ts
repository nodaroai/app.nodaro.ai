/**
 * What both halves of Trailer's builder share (the one-recording chain in
 * episode-trailer-graph.ts, the several-recordings chain in
 * episode-trailer-multicam.ts): the built node ids, the formats and the node
 * that delivers each, the render type, and the tail every trailer ends with —
 * the optional intro card played first (Combine Videos), one Social Media
 * Format per chosen format, and the output map. A leaf (it imports neither
 * half), so the two halves never load each other in a loop. Pure.
 */
import type { FormatsOutputMap, UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef } from "./use-case-graph"
import { usecaseEdge, usecaseNode } from "./use-case-graph-parts"
import { usecaseTypeOfBuilder } from "./use-case-rows"
import type { EpisodeTrailerGraph, EpisodeTrailerSettings } from "./episode-trailer-graph"

/** The render step: the shipped Apply EDL node, as in the template. */
export const TRAILER_RENDER_TYPE = "apply-edl"

/** The formats a trailer is delivered in, in the order they are delivered. */
export const TRAILER_FORMATS = ["9:16", "1:1", "4:5", "16:9"] as const
export type TrailerFormat = (typeof TRAILER_FORMATS)[number]

/** Each format's platform spec (the template's three, and a 1920×1080 landscape) and the node that delivers it. */
export const TRAILER_FORMAT_SPECS = Object.freeze({
  "9:16": { specKey: "instagram:story-reel", platform: "instagram", contentType: "story-reel", label: "Story / Reel (9:16)", nodeId: "uc-format-9x16" },
  "1:1": { specKey: "instagram:feed-square", platform: "instagram", contentType: "feed-square", label: "Square Feed (1:1)", nodeId: "uc-format-1x1" },
  "4:5": { specKey: "instagram:feed-portrait", platform: "instagram", contentType: "feed-portrait", label: "Portrait Feed (4:5)", nodeId: "uc-format-4x5" },
  "16:9": { specKey: "x:x-video", platform: "x", contentType: "x-video", label: "Landscape (16:9)", nodeId: "uc-format-16x9" },
} as const)

export const TRAILER_NODE_IDS = Object.freeze({
  source: "uc-source",
  transcribe: "uc-transcribe",
  plan: "uc-plan",
  render: "uc-render",
  intro: "uc-intro",
  combine: "uc-combine",
} as const)

const ID = TRAILER_NODE_IDS

/** The chain up to and including the render, the render's column, and a multicam run's Audio Sync and Speaker Map. */
export interface TrailerChainHead {
  readonly nodes: UseCaseGraphNode[]
  readonly edges: UseCaseGraphEdge[]
  /** The render's column: the intro card sits in it, Combine Videos one after, the formats two after. */
  readonly renderColumn: number
  /** A multicam run's Audio Sync and Speaker Map (the output map names them only when given). */
  readonly multicam?: FormatsOutputMap["multicam"]
}

/**
 * The tail every trailer ends with, after its render: the intro card played
 * first (Combine Videos) when one is given, one Social Media Format per chosen
 * format (padded, never cropped), and the output map. Appends to `head`'s own
 * arrays.
 */
export function withTrailerTail(
  settings: EpisodeTrailerSettings,
  sources: { readonly introCard?: { readonly url: string; readonly durationSec?: number } },
  head: TrailerChainHead,
): EpisodeTrailerGraph {
  const { nodes, edges, renderColumn: col } = head
  let trailer: UseCaseHandleRef = { nodeId: ID.render, handle: "media" }
  if (sources.introCard) {
    nodes.push(
      usecaseNode(ID.intro, "upload-video", col, 3, {
        label: "Intro card", assetId: "", url: sources.introCard.url,
        // Its probed length, declared as the recording's is (usecaseSourceNode): what Combine Videos is quoted on.
        ...(typeof sources.introCard.durationSec === "number" && sources.introCard.durationSec > 0
          ? { metadata: { durationSeconds: sources.introCard.durationSec } }
          : {}),
      }),
      usecaseNode(ID.combine, "combine-videos", col + 1, 1, {
        label: "Add Intro Card", transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", audioCrossfadeDuration: 0.5,
        trimEndFrames: 0, trimStartFrames: 0, smartCutFramesPrev: 8, smartCutFramesNext: 8, clipOrder: [ID.intro, ID.render],
      }),
    )
    edges.push(usecaseEdge(ID.intro, "video", ID.combine, "in"), usecaseEdge(ID.render, "media", ID.combine, "in"))
    trailer = { nodeId: ID.combine, handle: "video" }
  }
  for (const [row, format] of settings.formats.entries()) {
    const spec = TRAILER_FORMAT_SPECS[format]
    nodes.push(usecaseNode(spec.nodeId, "social-media-format", col + 2, row, {
      label: spec.label, platform: spec.platform, contentType: spec.contentType, specKey: spec.specKey,
      method: "pad", padColor: "#000000", formattedText: "",
    }))
    edges.push(usecaseEdge(trailer.nodeId, trailer.handle, spec.nodeId, "media"))
  }
  return {
    nodeType: usecaseTypeOfBuilder("trailer"),
    nodes,
    edges,
    outputMap: {
      kind: "formats",
      formats: settings.formats.map((format) => ({ format, ref: { nodeId: TRAILER_FORMAT_SPECS[format].nodeId, handle: "media" } })),
      preview: { nodeId: ID.render, handle: "media" },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
      ...(head.multicam ? { multicam: head.multicam } : {}),
    },
  }
}
