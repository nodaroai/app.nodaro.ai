/**
 * Edit with AI's line to the embedded editor (FreeCut): the requests it sends
 * and the replies it waits for, matched by request id. The protocol is the
 * editor's own (its `FREECUT_READY` capabilities `edit-ops`, `timeline-read`,
 * `playback`, `presence`); nothing here knows what an edit is for.
 */

export interface PresenceCursor {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly item?: string
  readonly frame?: number
  readonly trackId?: string
  readonly preview?: { readonly x: number; readonly y: number }
  readonly note?: string
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

export interface EditorLink {
  getTimeline(): Promise<unknown>
  applyOps(label: string, ops: ReadonlyArray<Record<string, unknown>>): Promise<OpsResult>
  undoEdit(label: string): Promise<{ readonly undone: boolean; readonly timeline?: unknown }>
  importFile(ref: string, name: string, type: string, buffer: ArrayBuffer): void
  playback(action: "seek" | "play" | "pause", frame?: number): void
  presence(cursors: readonly PresenceCursor[], highlights?: readonly PresenceHighlight[]): void
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
    getTimeline: async () => (await ask("NODARO_GET_TIMELINE", {})).timeline,
    applyOps: async (label, ops) => (await ask("NODARO_APPLY_OPS", { label, ops })) as unknown as OpsResult,
    undoEdit: async (label) => {
      const reply = await ask("NODARO_UNDO_EDIT", { label })
      return { undone: reply.undone === true, timeline: reply.timeline }
    },
    importFile: (ref, name, type, buffer) =>
      post("NODARO_IMPORT_FILES", { files: [{ ref, name, type, size: buffer.byteLength, buffer }] }, [buffer]),
    playback: (action, frame) => post("NODARO_PLAYBACK", { action, ...(frame === undefined ? {} : { frame }) }),
    presence: (cursors, highlights = []) => post("NODARO_PRESENCE", { cursors, highlights }),
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
