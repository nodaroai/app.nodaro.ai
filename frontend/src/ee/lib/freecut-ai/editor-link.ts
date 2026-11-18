/**
 * Edit with AI's line to the embedded editor (FreeCut): the requests it sends
 * and the replies it waits for, matched by request id. The protocol is the
 * editor's own (its `FREECUT_READY` capabilities `edit-ops`, `timeline-read`,
 * `playback`, `presence`); nothing here knows what an edit is for.
 *
 * `frame` is the window that holds the editor: the editor's own frame when the
 * panel sits beside it on this page, or the host page when the panel is itself
 * framed (`/embed/edit-with-ai`), which carries every request on to the editor.
 */
import {
  NODARO_APPLY_OPS,
  NODARO_GET_TIMELINE,
  NODARO_IMPORT_FILES,
  NODARO_PLAYBACK,
  NODARO_PRESENCE,
  NODARO_UNDO_EDIT,
} from "@nodaro/shared/media"

/** One line of what the agents did, for an editor that keeps an activity log (capability `studio-layout`). */
export interface ActivityLine {
  readonly agent: string
  readonly color: string
  readonly text: string
}

const NODARO_ACTIVITY = "NODARO_ACTIVITY"

/**
 * A move a cursor makes, drawn by the editor over its own interface (capability
 * `presence-targets`): the edit itself always comes as an op.
 */
export type PresenceGesture =
  | { readonly kind: "click" }
  | { readonly kind: "drag"; readonly to: string | { readonly frame: number; readonly trackId: string }; readonly label?: string; readonly durationMs?: number }
  | { readonly kind: "type"; readonly text: string; readonly durationMs?: number }
  | { readonly kind: "marquee"; readonly trackId: string; readonly from: number; readonly to: number }
  | { readonly kind: "lasso"; readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>; readonly durationMs?: number }
  | { readonly kind: "slide"; readonly from: number; readonly to: number; readonly durationMs?: number }
  | { readonly kind: "progress"; readonly value: number; readonly label?: string }
  /** A range of a track cut out: blades drop at both ends, then the range closes. */
  | { readonly kind: "cut"; readonly trackId: string; readonly from: number; readonly to: number; readonly durationMs?: number }
  /** A frame on the video that moves from one rectangle to another (fractions of the picture). */
  | { readonly kind: "frame"; readonly from: PresenceRect; readonly to: PresenceRect; readonly durationMs?: number }

/** A rectangle on the video, in fractions of the picture. */
export interface PresenceRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface PresenceCursor {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly item?: string
  readonly frame?: number
  readonly trackId?: string
  readonly preview?: { readonly x: number; readonly y: number }
  /** A named place in the editor's interface ("tool.razor", "panel.media", "media.item:<id>"…). */
  readonly target?: string
  readonly gesture?: PresenceGesture
  readonly note?: string
  /**
   * What the agent is doing, shown on its character (`presence` editors draw one;
   * an older editor ignores it): at work (absent), waiting its turn, done, or
   * stopped until the person answers.
   */
  readonly mood?: "working" | "waiting" | "done" | "needs-you"
}

export interface PresenceHighlight {
  readonly id: string
  readonly color: string
  readonly item?: string
  readonly trackId?: string
  readonly from?: number
  readonly to?: number
}

export interface OpsResult {
  readonly ok: boolean
  readonly results?: readonly unknown[]
  readonly recorded?: boolean
  readonly timeline?: unknown
  readonly error?: { readonly message: string; readonly index?: number }
}

const REPLY_TIMEOUT_MS = 45_000

let sequence = 0

/** The editor did not take a request: it is closed, or it did not answer in time. */
export class EditorLinkError extends Error {
  constructor(readonly reason: "closed" | "no-answer") {
    super(reason === "closed" ? "The editor is not open" : "The editor did not answer")
    this.name = "EditorLinkError"
  }
}

/** Original | Split | Edited, in the editor's own player (capability `compare`). */
export type CompareMode = "program" | "source" | "split"

export interface EditorLink {
  getTimeline(): Promise<unknown>
  /** One undo entry under `label`; `history: false` applies without one (a new tab, not an edit of this timeline). */
  applyOps(label: string, ops: ReadonlyArray<Record<string, unknown>>, options?: { readonly history?: boolean }): Promise<OpsResult>
  undoEdit(label: string): Promise<{ readonly undone: boolean; readonly timeline?: unknown }>
  importFile(ref: string, name: string, type: string, buffer: ArrayBuffer): void
  playback(action: "seek" | "play" | "pause", frame?: number): void
  /** Shows the original, both split, or the edit, in the editor's player. */
  compare(mode: CompareMode, split?: number): void
  /** Opens a timeline tab ("main" for the main one). */
  openSequence(sequenceId: string): void
  presence(cursors: readonly PresenceCursor[], highlights?: readonly PresenceHighlight[]): void
  /** Adds lines to the editor's activity log; an editor without one ignores them. */
  activity?(lines: readonly ActivityLine[]): void
  dispose(): void
}

/**
 * A link to the editor framed in `frame`, at `origin`. Replies are taken only
 * from that frame's window on that origin.
 */
export function createEditorLink(frame: () => Window | null | undefined, origin: string): EditorLink {
  const waiting = new Map<string, { resolve: (payload: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== frame()) return
    const payload = (event.data as { payload?: Record<string, unknown> } | null)?.payload
    const requestId = payload?.requestId
    if (typeof requestId !== "string") return
    const entry = waiting.get(requestId)
    if (!entry) return
    waiting.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(payload!)
  }
  window.addEventListener("message", onMessage)

  const post = (type: string, payload: Record<string, unknown>, transfer: Transferable[] = []) => {
    const target = frame()
    if (!target) throw new EditorLinkError("closed")
    target.postMessage({ type, payload }, origin, transfer)
  }

  const ask = (type: string, payload: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const requestId = `ai-edit-${Date.now().toString(36)}-${++sequence}`
      const timer = setTimeout(() => {
        waiting.delete(requestId)
        reject(new EditorLinkError("no-answer"))
      }, REPLY_TIMEOUT_MS)
      waiting.set(requestId, { resolve, reject, timer })
      try {
        post(type, { ...payload, requestId })
      } catch (error) {
        waiting.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new EditorLinkError("closed"))
      }
    })

  return {
    getTimeline: async () => (await ask(NODARO_GET_TIMELINE, {})).timeline,
    applyOps: async (label, ops, options) => (await ask(NODARO_APPLY_OPS, { label, ops, ...(options?.history === false ? { history: false } : {}) })) as unknown as OpsResult,
    undoEdit: async (label) => {
      const reply = await ask(NODARO_UNDO_EDIT, { label })
      return { undone: reply.undone === true, timeline: reply.timeline }
    },
    importFile: (ref, name, type, buffer) =>
      post(NODARO_IMPORT_FILES, { files: [{ ref, name, type, size: buffer.byteLength, buffer }] }, [buffer]),
    playback: (action, frame) => post(NODARO_PLAYBACK, { action, ...(frame === undefined ? {} : { frame }) }),
    compare: (mode, split) => post(NODARO_PLAYBACK, { action: "compare", mode, ...(split === undefined ? {} : { split }) }),
    openSequence: (sequenceId) => post(NODARO_PLAYBACK, { action: "open-sequence", sequenceId }),
    presence: (cursors, highlights = []) => post(NODARO_PRESENCE, { cursors, highlights }),
    activity: (lines) => post(NODARO_ACTIVITY, { lines }),
    dispose: () => {
      window.removeEventListener("message", onMessage)
      for (const entry of waiting.values()) {
        clearTimeout(entry.timer)
        entry.reject(new EditorLinkError("closed"))
      }
      waiting.clear()
    },
  }
}
