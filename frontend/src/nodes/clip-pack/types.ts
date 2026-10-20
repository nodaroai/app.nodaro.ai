import type { CaptionStyle } from "@nodaro/shared/captions"
import type { UseCaseCamerasInput, UseCaseCamerasReport } from "@nodaro/render-rules"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Clip Pack (podcast use-case node, decided 2026-10-14): one recording in
 *  (or — for a viewer who may use Speaker Map — the cameras of one
 *  conversation and a Master audio, decided 2026-10-17, each clip cut between
 *  them);
 *  a pack of short clips out (`clips`, a list that fans out on an Each wire —
 *  video, or audio for an audio recording), and the plan's clip set on `json`
 *  (an EDL per clip, the review applied). Settings mirror
 *  @nodaro/render-rules' ClipPackSettings. */
export type ClipPackData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  /** The recordings' order (their upstream node ids): the run sends and builds them in it; a wired recording it does not list follows in wire order. */
  mediaOrder?: string[]
  /** On two or more recordings or a Master audio: the wide shot (a camera's position), recordings already in sync, and who is on which camera (speaker ordinal → camera position, 0 = the wide shot). Read only by a multicam run. */
  cameras?: UseCaseCamerasInput
  count?: number
  targetDurationSec?: number
  /** null = no framing (the recording's shape); absent = the run's default framing. */
  framing?: { aspect: "16:9" | "9:16" | "1:1" | "4:5"; layout: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"; switchType?: string; emphasisStyle?: string } | null
  /** Where a framed pack's boxes come from: the even split by speaker (`static`), Speaker Frames following faces (`tracking`), or tracking where it is available (`auto`, a new node's default). Absent = static (a saved node keeps its run). Read only with a framing. */
  framingSource?: "auto" | "static" | "tracking"
  captions?: boolean
  captionStyle?: CaptionStyle
  reviewBeforeRender?: boolean
  planTier?: "economy" | "standard" | "premium"
  instructions?: string
  styleGuide?: string
  /** Editor-only: the Framing and Captions an audio recording turned off, given back when a video is wired again (lib/use-case-audio-lock.ts). The run never reads it. */
  settingsBeforeAudio?: { framing?: ClipPackData["framing"]; captions?: boolean }
  /** The run's wrapper job (Continue / Render final address it). */
  useCaseJobId?: string
  useCaseExecutionId?: string
  /** Set by Continue / Render final for the next single-node run, then cleared. */
  useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }
  /** The plan (the clip set) and the reviewer's edit of it. */
  generatedJson?: unknown
  editedEdl?: unknown
  generatedTranscript?: unknown
  generatedVideoUrl?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  /** How many clips the last run could not deliver — its camera switch or its render failed (the others were delivered). */
  failedClips?: number
  /** The last multicam run's report: who was put on which camera, and Audio Sync's and Speaker Map's notes. */
  useCaseCameras?: UseCaseCamerasReport
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
