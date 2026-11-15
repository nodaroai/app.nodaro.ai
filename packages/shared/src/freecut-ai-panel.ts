// Edit with AI in a frame: the platform serves its panel at AI_PANEL_PATH, and a
// product that embeds the editor (FreeCut) frames it beside the editor. The
// editor takes commands only from the page that frames it, so that page carries
// the panel's edit requests to the editor and the editor's answers back
// (`routeAiPanelMessage`). The panel's own words to its host are below; it signs
// in through the platform's embed session handoff (`nodaro:embedReady`).
import {
  FREECUT_OPS_RESULT,
  FREECUT_TIMELINE,
  FREECUT_UNDO_RESULT,
  NODARO_APPLY_OPS,
  NODARO_GET_TIMELINE,
  NODARO_IMPORT_FILES,
  NODARO_PLAYBACK,
  NODARO_PRESENCE,
  NODARO_UNDO_EDIT,
  type FreecutImportFile,
} from "./freecut-protocol.js"

/** Where the platform serves the panel, under its app origin. */
export const AI_PANEL_PATH = "/embed/edit-with-ai"
export const AI_PANEL_PROTOCOL_VERSION = 1

// The panel (frame) -> its host
/** The panel is loaded and listening; repeated until the host answers with INIT. */
export const NODARO_AI_PANEL_READY = "NODARO_AI_PANEL_READY"
/** The person closed the panel. */
export const NODARO_AI_PANEL_CLOSE = "NODARO_AI_PANEL_CLOSE"
/** The panel asks for the whole editor area (`wide: true`, to show the original video) or its side column. */
export const NODARO_AI_PANEL_LAYOUT = "NODARO_AI_PANEL_LAYOUT"

// The host -> the panel
/** What the panel works on; sent again whenever it changes (a video imported, the editor ready). */
export const NODARO_AI_PANEL_INIT = "NODARO_AI_PANEL_INIT"

/** What the editor must say it can do (its FREECUT_READY `capabilities`) for the panel to be offered. */
export const AI_PANEL_EDITOR_CAPABILITIES = ["edit-ops", "timeline-read", "playback", "presence"] as const

/** The editor's requests a host carries from the panel to the editor. */
export const AI_PANEL_EDITOR_REQUESTS: readonly string[] = [
  NODARO_GET_TIMELINE,
  NODARO_APPLY_OPS,
  NODARO_UNDO_EDIT,
  NODARO_IMPORT_FILES,
  NODARO_PLAYBACK,
  NODARO_PRESENCE,
]

/** The editor's answers a host carries back to the panel: only to a request the panel made. */
export const AI_PANEL_EDITOR_ANSWERS: readonly string[] = [FREECUT_TIMELINE, FREECUT_OPS_RESULT, FREECUT_UNDO_RESULT]

/** A video the host can give an address for, by the file name the editor shows for it. */
export interface AiPanelVideo {
  readonly url: string
  readonly name: string
}

export interface AiPanelInitPayload {
  readonly version: number
  /** The editor's FREECUT_READY `capabilities`; empty until the editor is ready. */
  readonly capabilities: readonly string[]
  /** The videos the host knows an address for. The panel never edits one it cannot listen to. */
  readonly videos: readonly AiPanelVideo[]
  /** The video the editor was opened on, when there is one (its `url`). */
  readonly openedVideoUrl?: string
  /**
   * Which project the editor holds. The host changes it when it starts a fresh
   * one, and the panel then forgets what it did in the old one.
   */
  readonly project?: number
}

export interface AiPanelLayoutPayload {
  readonly wide: boolean
}

/** Whether an editor with these capabilities can be edited by the panel. */
export function aiPanelOffered(capabilities: readonly string[]): boolean {
  return AI_PANEL_EDITOR_CAPABILITIES.every((c) => capabilities.includes(c))
}

/** The parts of a `MessageEvent` the route reads. */
export interface AiPanelRelayEvent {
  readonly data: unknown
  readonly origin: string
  readonly source: unknown
}

export interface AiPanelRelayContext {
  readonly panel: unknown
  readonly panelOrigin: string
  readonly editor: unknown
  readonly editorOrigin: string
  /** The request ids the panel asked and the editor has not answered yet. Updated in place by `routeAiPanelMessage`. */
  readonly asked: Set<string>
}

/** Where a message goes, and the buffers to hand over with it. */
export interface AiPanelRoute {
  readonly to: "editor" | "panel"
  readonly message: { readonly type: string; readonly payload: Record<string, unknown> }
  readonly transfer: ArrayBuffer[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Where a host passes one message, or null when it is not the panel's to pass.
 * From the panel's own frame on its origin: one of the editor's requests, to the
 * editor (an import hands its buffers over again). From the editor's frame on
 * its origin: an answer to a request the panel made, back to the panel, once.
 * Everything else (the host's own traffic, other frames) is left alone.
 */
export function routeAiPanelMessage(event: AiPanelRelayEvent, ctx: AiPanelRelayContext): AiPanelRoute | null {
  const data = event.data
  if (!isRecord(data) || typeof data.type !== "string") return null
  const payload = isRecord(data.payload) ? data.payload : {}
  if (event.source === ctx.panel && ctx.panel != null && event.origin === ctx.panelOrigin) {
    if (!AI_PANEL_EDITOR_REQUESTS.includes(data.type)) return null
    if (typeof payload.requestId === "string") ctx.asked.add(payload.requestId)
    const files = data.type === NODARO_IMPORT_FILES && Array.isArray(payload.files) ? (payload.files as Partial<FreecutImportFile>[]) : []
    const transfer = files.map((f) => f.buffer).filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)
    return { to: "editor", message: { type: data.type, payload }, transfer }
  }
  if (event.source === ctx.editor && ctx.editor != null && event.origin === ctx.editorOrigin) {
    if (!AI_PANEL_EDITOR_ANSWERS.includes(data.type)) return null
    const requestId = payload.requestId
    if (typeof requestId !== "string" || !ctx.asked.delete(requestId)) return null
    return { to: "panel", message: { type: data.type, payload }, transfer: [] }
  }
  return null
}

/** A window a relay can listen on and post to (the host's own `window`). */
interface RelayWindow {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

interface PostTarget {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void
}

export interface AiPanelRelayOptions {
  /** The host page's window, which both frames post to. */
  readonly host: RelayWindow
  readonly panel: () => PostTarget | null | undefined
  readonly panelOrigin: string
  readonly editor: () => PostTarget | null | undefined
  readonly editorOrigin: string
}

/** Carry the panel's edit requests to the editor and the answers back, until disposed. */
export function createAiPanelRelay(options: AiPanelRelayOptions): { dispose(): void } {
  const asked = new Set<string>()
  const onMessage = (event: MessageEvent) => {
    const panel = options.panel()
    const editor = options.editor()
    const route = routeAiPanelMessage(event, { panel, panelOrigin: options.panelOrigin, editor, editorOrigin: options.editorOrigin, asked })
    if (!route) return
    const target = route.to === "editor" ? editor : panel
    target?.postMessage(route.message, route.to === "editor" ? options.editorOrigin : options.panelOrigin, route.transfer)
  }
  options.host.addEventListener("message", onMessage)
  return {
    dispose: () => {
      options.host.removeEventListener("message", onMessage)
      asked.clear()
    },
  }
}
