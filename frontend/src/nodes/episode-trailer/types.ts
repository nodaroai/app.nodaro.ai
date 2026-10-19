import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Trailer (podcast use-case node, decided 2026-10-14): one video recording
 *  in; a 20–40 s trailer out in every chosen format (`media`, a list that fans
 *  out on an Each wire), optionally after an intro card (`introCard`), and the
 *  plan's EDL on `json`. Settings mirror @nodaro/render-rules'
 *  EpisodeTrailerSettings. */
export type EpisodeTrailerData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
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
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
