import type { UseCaseCamerasInput, UseCaseCamerasReport } from "@nodaro/render-rules"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Trailer (podcast use-case node, decided 2026-10-14): one video recording
 *  in (or — for a viewer who may use Speaker Map — the cameras of one
 *  conversation and a Master audio, decided 2026-10-17); a 20–40 s trailer out in every chosen format (`media`, a list that fans
 *  out on an Each wire), optionally after an intro card (`introCard`), and the
 *  plan's EDL on `json`. Settings mirror @nodaro/render-rules'
 *  EpisodeTrailerSettings. */
export type EpisodeTrailerData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  /** The recordings' order (their upstream node ids): the run sends and builds them in it; a wired recording it does not list follows in wire order. */
  mediaOrder?: string[]
  /** On two or more recordings or a Master audio: the wide shot (a camera's position), recordings already in sync, and who is on which camera (speaker ordinal → camera position, 0 = the wide shot). Read only by a multicam run. */
  cameras?: UseCaseCamerasInput
  formats?: Array<"9:16" | "1:1" | "4:5" | "16:9">
  reviewBeforeRender?: boolean
  planTier?: "economy" | "standard" | "premium"
  instructions?: string
  styleGuide?: string
  /** The run's wrapper job (Continue / Render final address it). */
  useCaseJobId?: string
  useCaseExecutionId?: string
  /** Set by Continue / Render final for the next single-node run, then cleared. */
  useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }
  /** The plan (an EDL) and the reviewer's edit of it. */
  generatedJson?: unknown
  editedEdl?: unknown
  generatedTranscript?: unknown
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  /** The formats the last run could not render (the others were delivered). */
  failedFormats?: readonly string[]
  /** The last multicam run's report: who was put on which camera, and Audio Sync's and Speaker Map's notes. */
  useCaseCameras?: UseCaseCamerasReport
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
