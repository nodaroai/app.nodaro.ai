import type { CaptionStyle } from "@nodaro/shared/captions"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Tighten Episode (podcast use-case node): one recording in, the tightened
 *  episode out — the shipped transcribe → silence → plan → render chain, built
 *  and run on the server as one job. Settings mirror @nodaro/render-rules'
 *  TightenEpisodeSettings; results mirror the wrapper job's output. */
export type TightenEpisodeData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
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
  activeResultIndex?: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
