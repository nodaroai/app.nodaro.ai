import type { Edl, SpeakerMapResult } from "@nodaro/shared/edl"
import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** Speaker Map: the node's data. Every field here is a node setting gen:skills documents. */
export type SpeakerMapData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
  /** The recordings wired into Cameras, by upstream node id: these first, the rest after them in wire order. */
  sourceOrder?: string[]
  /** The recording that is the master audio: no one's camera, and the edit's clock. Ignored once it is no longer wired. */
  masterSourceId?: string
  /** The recording that is the wide shot: no one's camera; a speaker with no clear camera is shown on it. Ignored once it is no longer wired. */
  wideSourceId?: string
  /** How far, in dB, the loudest camera must lead the next for a speaker to get it (default 3). */
  marginDb?: number
  /** The "json" output: speaker → camera, with each speaker's lead and the notes. */
  generatedJson?: SpeakerMapResult
  /** The "edl" output: the recordings as one edit on the master clock. */
  generatedEdl?: Edl
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}
