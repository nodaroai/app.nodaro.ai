import type { FieldMappings, GeneratedResult } from "@/types/nodes"

// Remove Audio: video in → silent video out. No config params.
export type RemoveAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}
