/**
 * What both halves of Tighten Episode's builder share (the one-recording chain
 * in tighten-episode-graph.ts, the several-recordings chain in
 * tighten-episode-multicam.ts): the built node ids, the render types, and the
 * tail every episode ends with — captions on the render, the music bed mixed
 * under it, and the output map. A leaf (it imports neither half), so the two
 * halves never load each other in a loop. Pure.
 */
import type { EpisodeOutputMap, UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef } from "./use-case-graph"
import { usecaseEdge, usecaseNode } from "./use-case-graph-parts"
import { usecaseTypeOfBuilder } from "./use-case-rows"
import type { TightenEpisodeGraph, TightenEpisodeSettings } from "./tighten-episode-graph"

export const TIGHTEN_NODE_IDS = Object.freeze({
  source: "uc-source",
  transcribe: "uc-transcribe",
  silence: "uc-silence",
  plan: "uc-plan",
  render: "uc-render",
  captions: "uc-captions",
  music: "uc-music",
  mix: "uc-mix",
  merge: "uc-merge",
} as const)

/** The render without framing (Apply EDL), and with it (Speaker View on automatic boxes). */
export const TIGHTEN_RENDER_TYPE = "apply-edl"
export const TIGHTEN_FRAMED_RENDER_TYPE = "speaker-view"

const ID = TIGHTEN_NODE_IDS

/** The chain up to and including the render, and whether the render is framed (Speaker View). */
export interface TightenChainHead {
  readonly nodes: UseCaseGraphNode[]
  readonly edges: UseCaseGraphEdge[]
  readonly framed: boolean
  /** A multicam run's Audio Sync and Speaker Map (the output map names them only when given). */
  readonly multicam?: EpisodeOutputMap["multicam"]
}

/**
 * The tail every Tighten episode ends with, after its render: captions on the
 * render's media and its transcript pip (video episodes with captions on), the
 * music bed mixed under the render (and merged back onto the picture for a
 * video episode), and the output map. Appends to `head`'s own arrays.
 */
export function withTightenTail(
  settings: TightenEpisodeSettings,
  sources: { readonly music?: { readonly url: string } },
  head: TightenChainHead,
): TightenEpisodeGraph {
  const { nodes, edges, framed } = head
  const renderMediaHandle = framed ? "video" : "media"
  let media: UseCaseHandleRef = { nodeId: ID.render, handle: renderMediaHandle }

  if (settings.output === "video" && settings.captions) {
    nodes.push(usecaseNode(ID.captions, "add-captions", 4, 0, {
      label: "Add Captions", style: settings.captionStyle, wordLevel: false, position: "bottom", fontSize: 24, color: "#ffffff",
    }))
    // Apply EDL's remapped transcript is its `json`; Speaker View's is its `transcript` pip.
    edges.push(usecaseEdge(ID.render, renderMediaHandle, ID.captions, "in"), usecaseEdge(ID.render, framed ? "transcript" : "json", ID.captions, "transcript"))
    media = { nodeId: ID.captions, handle: "video-out" }
  }

  if (sources.music) {
    nodes.push(
      usecaseNode(ID.music, "upload-audio", 3, 3, { label: "Music bed", assetId: "", url: sources.music.url }),
      usecaseNode(ID.mix, "mix-audio", 4, 2, {
        label: "Music under episode", trackCount: 2, trackVolumes: {}, trackOrder: [ID.render, ID.music],
        duckUnder: ID.render, duckAmount: settings.musicDuckAmount, endAt: "voice",
      }),
    )
    edges.push(usecaseEdge(ID.render, renderMediaHandle, ID.mix, "in"), usecaseEdge(ID.music, "audio", ID.mix, "in"))
    if (settings.output === "video") {
      nodes.push(usecaseNode(ID.merge, "merge-video-audio", 5, 1, {
        label: "Episode with music", audioType: "voiceover", voiceoverVolume: 100, backgroundVolume: 30,
        keepOriginalAudio: false, originalAudioVolume: 30, originalAudioRole: "background", trackSettings: {},
      }))
      edges.push(usecaseEdge(media.nodeId, media.handle, ID.merge, "in"), usecaseEdge(ID.mix, "audio-out", ID.merge, "in"))
      media = { nodeId: ID.merge, handle: "video-out" }
    } else {
      media = { nodeId: ID.mix, handle: "audio-out" }
    }
  }

  return {
    nodeType: usecaseTypeOfBuilder("tighten"),
    nodes,
    edges,
    outputMap: {
      media,
      preview: { nodeId: ID.render, handle: renderMediaHandle },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
      ...(head.multicam ? { multicam: head.multicam } : {}),
    },
  }
}
