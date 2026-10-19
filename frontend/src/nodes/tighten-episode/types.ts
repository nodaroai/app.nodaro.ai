import type { CaptionStyle } from "@nodaro/shared/captions"
import type { UseCaseCamerasInput, UseCaseCamerasReport } from "@nodaro/render-rules"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Tighten Episode (podcast use-case node): one recording in, the tightened
 *  episode out — the shipped transcribe → silence → plan → render chain, built
 *  and run on the server as one job. Settings mirror @nodaro/render-rules'
 *  TightenEpisodeSettings; results mirror the wrapper job's output. */
export type TightenEpisodeData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  /** The recordings' order (their upstream node ids): the run sends and builds them in it; a wired recording it does not list follows in wire order. */
  mediaOrder?: string[]
  /** On two or more recordings or a Master audio: the wide shot (a camera's position), recordings already in sync, and who is on which camera (speaker ordinal → camera position, 0 = the wide shot). Read only by a multicam run. */
  cameras?: UseCaseCamerasInput
  output?: "video" | "audio"
  /** Frame the episode with Speaker View: an output aspect and a layout, on
   *  automatic boxes — the shipped default boxes over the speakers on screen,
   *  tracked speakers followed. null/absent = no framing. */
  framing?: { aspect: "16:9" | "9:16" | "1:1" | "4:5"; layout: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip" } | null
  captions?: boolean
  captionStyle?: CaptionStyle
  reviewBeforeRender?: boolean
  planTier?: "economy" | "standard" | "premium"
  instructions?: string
  styleGuide?: string
  musicDuckAmount?: number
  /** Editor-only: the Output and Captions an audio recording turned off, given back when a video is wired again (lib/use-case-audio-lock.ts). The run never reads it. */
  settingsBeforeAudio?: { output?: "video" | "audio"; captions?: boolean }
  /** The run's wrapper job (Continue / Render final address it). */
  useCaseJobId?: string
  useCaseExecutionId?: string
  /** Set by Continue / Render final for the next single-node run, then cleared. */
  useCaseContinue?: { mode: "from-failed" | "render-final"; jobId: string }
  /** The plan (an EDL, dropped[] included) and the reviewer's edit of it. */
  generatedJson?: unknown
  editedEdl?: unknown
  generatedTranscript?: unknown
  generatedVideoUrl?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  /** The last multicam run's report: who was put on which camera, and Audio Sync's and Speaker Map's notes. */
  useCaseCameras?: UseCaseCamerasReport
  activeResultIndex?: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
