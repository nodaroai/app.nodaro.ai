/**
 * A use-case node's inputs (decided 2026-10-13), routed by the handle they
 * are wired to, ahead of any source-type routing: the recording on `media`,
 * the music bed on `music`, the intro card on `introCard`, the separate master
 * audio on `masterAudio`. Called by the input
 * resolver on the inputs object it is building.
 */
import type { ResolvedInputs, SimpleEdge } from "./types.js"

/** True when the wire was routed here (the resolver then stops). */
export function routeUseCaseInput(inputs: ResolvedInputs, edge: SimpleEdge, sourceId: string, output: string): boolean {
  if (edge.targetHandle === "media") {
    inputs.useCaseMedia = [...(inputs.useCaseMedia ?? []), { nodeId: sourceId, url: output }]
    return true
  }
  if (edge.targetHandle === "music") {
    inputs.useCaseMusic = output
    return true
  }
  if (edge.targetHandle === "introCard") {
    inputs.useCaseIntroCard = output
    return true
  }
  if (edge.targetHandle === "masterAudio") {
    inputs.useCaseMasterAudio = output
    return true
  }
  return false
}
