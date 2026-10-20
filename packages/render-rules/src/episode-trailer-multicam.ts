/**
 * Trailer on two or more recordings or a Master audio (decided 2026-10-17):
 * the multicam front before the trailer plan — the recordings, the sound,
 * Audio Sync (unless already in sync), Speaker Map with two or more cameras —
 * Transcribe on the sound, the trailer plan over every recording with its
 * role and Audio Sync's offsets, Camera Switch between the plan and the render
 * with two or more cameras, then the one-recording tail unchanged (the intro
 * card through Combine Videos, one Social Media Format per chosen format, the
 * formats output map). The render resolves each camera from the edit itself
 * (no sources wire), as the Multicam Cut template's does, and reads the
 * switched edit's renamed transcript. Every format is a video: Trailer refuses
 * a sound-only run, so there is no audio branch. Pure.
 */
import type { UseCaseSources } from "./use-case-registry"
import { USE_CASE_CAMERAS_DEFAULTS } from "./use-case-cameras"
import { usecaseEdge, usecaseNode } from "./use-case-graph-parts"
import { usecaseMulticamPlanChain } from "./use-case-multicam-chain"
import { TRAILER_NODE_IDS, TRAILER_RENDER_TYPE, withTrailerTail } from "./episode-trailer-parts"
import type { EpisodeTrailerGraph, EpisodeTrailerSettings } from "./episode-trailer-graph"

const ID = TRAILER_NODE_IDS

/** Trailer's chain on several recordings or a Master audio (see the module note). */
export function buildTrailerMulticamGraph(settings: EpisodeTrailerSettings, sources: UseCaseSources): EpisodeTrailerGraph {
  const cameras = settings.cameras ?? USE_CASE_CAMERAS_DEFAULTS
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  const chain = usecaseMulticamPlanChain(sources, cameras, {
    transcribeId: ID.transcribe,
    planId: ID.plan,
    plan: (order, config) => usecaseNode(ID.plan, "edit-plan", 2, 1, {
      label: "Trailer Plan", mode: "trailer", planTier: settings.planTier, instructions: settings.instructions,
      ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
      sourceOrder: [...order], sourceConfig: { ...config },
    }),
    switchAt: { column: 3, row: 1 },
  })
  // With a switch the render reads the switched edit and its renamed transcript; without one, the plan's edit and the transcript.
  const { nodes, edges, edit, named } = chain
  nodes.push(usecaseNode(ID.render, TRAILER_RENDER_TYPE, 4, 1, { label: "Apply Cut", output: "video", quality, crossfadeMs: 0 }))
  edges.push(usecaseEdge(edit.nodeId, edit.handle, ID.render, "edl"), usecaseEdge(named.nodeId, named.handle, ID.render, "transcript"))
  return withTrailerTail(settings, sources, { nodes, edges, renderColumn: 4, ...(chain.multicam ? { multicam: chain.multicam } : {}) })
}
