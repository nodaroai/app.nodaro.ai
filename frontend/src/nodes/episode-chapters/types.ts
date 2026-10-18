import type { FieldMappings } from "@/types/nodes"

/** Chapters (podcast use-case node, decided 2026-10-14): one recording in;
 *  its chapters out as show notes on `text` (`generatedText`, one
 *  `0:00 Title` line per chapter) and as a list on `json` (`generatedJson`,
 *  `{ startMs, title }[]`). Nothing renders and nothing is reviewed. Settings
 *  mirror @nodaro/render-rules' EpisodeChaptersSettings. */
export type EpisodeChaptersData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  planTier?: "economy" | "standard" | "premium"
  instructions?: string
  styleGuide?: string
  /** The run's wrapper job (Continue addresses it). */
  useCaseJobId?: string
  useCaseExecutionId?: string
  /** The show notes. */
  generatedText?: string
  /** The chapter list. */
  generatedJson?: unknown
  generatedTranscript?: unknown
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
}
