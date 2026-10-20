import type { UseCaseCamerasInput, UseCaseCamerasReport, UseCaseFramingSource } from "@nodaro/render-rules"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Speaker Layout (podcast use-case node, decided 2026-10-17): a whole recording
 *  framed by speaker, the same length, no cut — one recording framed in turn,
 *  or (for a viewer who may use Speaker Map) the cameras of one conversation
 *  and a Master audio, each speaker on their own camera. The framed video out
 *  on `media`, the edit Speaker View drew on `json`. Settings mirror
 *  @nodaro/render-rules' SpeakerLayoutSettings. */
export type SpeakerLayoutData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  /** The recordings' order (their upstream node ids): the run sends and builds them in it; a wired recording it does not list follows in wire order. */
  mediaOrder?: string[]
  /** On two or more recordings or a Master audio: the wide shot (a camera's position), recordings already in sync, and who is on which camera (speaker ordinal → camera position, 0 = the wide shot). */
  cameras?: UseCaseCamerasInput
  targetAspect?: "9:16" | "1:1" | "4:5" | "16:9"
  layout?: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"
  switchType?: string
  emphasisStyle?: string
  /** Where the boxes come from: the even split, Speaker Frames following faces, or `auto` (follow faces while Speaker Frames is available to the viewer). */
  framingSource?: UseCaseFramingSource
  reviewBeforeRender?: boolean
  /** The run's wrapper job (Continue / Render final address it). */
  useCaseJobId?: string
  useCaseExecutionId?: string
  /** Set by Continue / Render final for the next single-node run, then cleared. */
  useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }
  /** The edit Speaker View drew (an EDL). */
  generatedJson?: unknown
  generatedTranscript?: unknown
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  /** The last multicam run's report: who was put on which camera, and Audio Sync's and Speaker Map's notes. */
  useCaseCameras?: UseCaseCamerasReport
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
