/**
 * A use-case node (Tighten Episode, decided 2026-10-13) on the canvas's own
 * engine: what it takes in and what it hands on — the mirror of the server's
 * `use-case-inputs.ts` and its saved-output read (`extractSavedNodeOutput`).
 */
import { usecaseResultIsText } from "@nodaro/render-rules"
import { usecaseJsonOf } from "@/lib/edit-plan-saved-output"

/** What a use-case node's wires resolve to. */
export interface UseCaseResolvedInputs {
  /** The recording(s) wired into `media`, each with its source node. */
  useCaseMedia?: Array<{ nodeId: string; url: string }>
  /** The music bed wired into `music`. */
  useCaseMusic?: string
  /** The intro card wired into `introCard`. */
  useCaseIntroCard?: string
  /** The separate audio wired into `masterAudio` (a type whose descriptor takes it reads it). */
  useCaseMasterAudio?: string
  /** The upstream node `useCaseMasterAudio` comes from: a master from the node a recording comes from is no master (`usecaseRunRecordings`). */
  useCaseMasterAudioNodeId?: string
}

/**
 * Route a wire into a use-case node by the handle it lands on, ahead of any
 * source-type routing: the recording on `media`, the bed on `music`, the card
 * on `introCard`, the master on `masterAudio`. True when
 * the wire was routed here (the resolver then moves on).
 */
export function routeUseCaseInput(inputs: UseCaseResolvedInputs, targetHandle: string | null | undefined, sourceId: string, output: string): boolean {
  if (targetHandle === "media") {
    inputs.useCaseMedia = [...(inputs.useCaseMedia ?? []), { nodeId: sourceId, url: output }]
    return true
  }
  if (targetHandle === "music") {
    inputs.useCaseMusic = output
    return true
  }
  if (targetHandle === "introCard") {
    inputs.useCaseIntroCard = output
    return true
  }
  if (targetHandle === "masterAudio") {
    inputs.useCaseMasterAudio = output
    inputs.useCaseMasterAudioNodeId = sourceId
    return true
  }
  return false
}

/**
 * What a use-case node hands on, from what it holds: on `json` its plan with
 * the person's review applied (the Edit Plan's own read, which the server's
 * saved branch makes too — Chapters' chapter list with a clip-set edit
 * applied) — stringified for generic consumers, nothing for a null plan; on `text` its text (Chapters' show notes — also what an edge
 * naming no pip reads on such a type); on any other pip the
 * episode, video or audio. Mirrors the server's saved and live reads
 * (`output-extractor.ts`).
 */
export function usecaseSavedOutput(nodeType: string, data: Readonly<Record<string, unknown>>, sourceHandle: string | undefined): string | undefined {
  if (sourceHandle === "json") {
    const plan = usecaseJsonOf(data)
    return plan === undefined ? undefined : JSON.stringify(plan)
  }
  if (sourceHandle === "text" || (sourceHandle === undefined && usecaseResultIsText(nodeType))) {
    const text = data.generatedText
    return typeof text === "string" && text !== "" ? text : undefined
  }
  const video = data.generatedVideoUrl
  if (typeof video === "string" && video !== "") return video
  const audio = data.generatedAudioUrl
  return typeof audio === "string" && audio !== "" ? audio : undefined
}

/** Whether a use-case node's wire carries its episode (lib/use-case-pips.ts). */
export { usecaseHandsOnEpisode } from "@/lib/use-case-pips"

/** Whether the episode a use-case node holds is a video (else audio) — the server's rule. */
export function usecaseHoldsVideo(data: Readonly<Record<string, unknown>>): boolean {
  return typeof data.generatedVideoUrl === "string" && data.generatedVideoUrl !== ""
}
