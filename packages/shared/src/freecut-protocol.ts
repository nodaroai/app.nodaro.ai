// Single source of truth for the Nodaro <-> FreeCut iframe postMessage protocol.
// Imported by app's freecut-editor-modal and Studio's ported modal so the wire
// format cannot drift. The fork (Nodaro-ai/freecut-fork) mirrors these strings in
// src/features/embedded/services/embedded-message-handler.ts + use-send-back.ts.

// Nodaro (parent) -> FreeCut (iframe)
export const NODARO_LOAD_VIDEO = "NODARO_LOAD_VIDEO"
// Multi-clip analog of NODARO_LOAD_VIDEO: lay N ordered urls on the timeline as
// sequential clips (FreeCut fetches them itself). Used by Studio's production
// "Edit in FreeCut" to assemble the whole cut.
export const NODARO_LOAD_TIMELINE = "NODARO_LOAD_TIMELINE"
export const NODARO_IMPORT_FILES = "NODARO_IMPORT_FILES"
export const NODARO_RESET_PROJECT = "NODARO_RESET_PROJECT"

// FreeCut (iframe) -> Nodaro (parent)
export const FREECUT_READY = "FREECUT_READY"
export const FREECUT_EXPORT_COMPLETE = "FREECUT_EXPORT_COMPLETE"
export const FREECUT_EXPORT_PROGRESS = "FREECUT_EXPORT_PROGRESS" // reserved; fork emits it, v1 parents ignore it
export const FREECUT_REQUEST_IMPORT = "FREECUT_REQUEST_IMPORT"

export interface FreecutImportFile {
  readonly name: string
  readonly type: string
  readonly size: number
  readonly buffer: ArrayBuffer
}

export interface NodaroLoadVideoPayload {
  readonly videoUrl: string
  readonly videoBuffer?: ArrayBuffer
  readonly projectJson?: unknown
  readonly additionalFiles?: ReadonlyArray<FreecutImportFile>
}

export interface NodaroLoadTimelinePayload {
  // Ordered clip urls; FreeCut fetches each and lays them end-to-end on the timeline.
  readonly clips: ReadonlyArray<string>
}

export interface FreecutExportCompletePayload {
  readonly videoBuffer: ArrayBuffer
  readonly projectJson?: unknown
}

export interface FreecutExportProgressPayload {
  readonly percent: number
}

export interface FreecutRequestImportPayload {
  readonly accept?: string
  readonly multiple?: boolean
}
