import type { CaptionStyle } from "@nodaro/shared/captions"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Clip Pack (podcast use-case node, decided 2026-10-14): one recording in;
 *  a pack of short clips out (`clips`, a list that fans out on an Each wire —
 *  video, or audio for an audio recording), and the plan's clip set on `json`
 *  (an EDL per clip, the review applied). Settings mirror
 *  @nodaro/render-rules' ClipPackSettings. */
export type ClipPackData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  count?: number
  targetDurationSec?: number
  /** null = no framing (the recording's shape); absent = the run's default framing. */
  framing?: { aspect: "16:9" | "9:16" | "1:1" | "4:5"; layout: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"; switchType?: string; emphasisStyle?: string } | null
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
  /** How many clips the last run could not render (the others were delivered). */
  failedClips?: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
