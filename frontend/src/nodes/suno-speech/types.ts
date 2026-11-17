import type { SunoSpeechMode, SunoSpeechVocalGender } from "@nodaro/render-rules"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Suno Speech: the node's data. Every field here is a node setting gen:skills documents. */
export type SunoSpeechData = {
  [key: string]: unknown
  label: string
  /** "brief" (default): Suno writes and performs the script from `prompt`. "script": it speaks `script`. */
  mode?: SunoSpeechMode
  /** Brief mode: a one-line scene description, 1-3,000 characters. Wired text (the "prompt" input) wins. */
  prompt?: string
  /** Script mode: the words to speak, 1-5,000 characters, multiline. Wired text (the "prompt" input) wins. */
  script?: string
  /** Script mode: tone, rhythm, emotion and setting (accent, accompaniment), up to 1,000 characters. */
  tone?: string
  /** Script mode: how far the two takes differ, 0 (exact style) to 4 (unreasonably varied). Unset: the model's default. */
  variety?: number
  /** Script mode: the voice gender. Unset: the model picks. */
  vocalGender?: SunoSpeechVocalGender
  /** Script mode: add background music (default off). */
  backgroundMusic?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobId?: string
  currentJobProgress?: number
  /** The "audio" output: the active take. */
  generatedAudioUrl?: string
  /** Both takes of every run. */
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}
