import { describe, expect, it, vi } from "vitest"
import {
  AI_PANEL_EDITOR_ANSWERS,
  AI_PANEL_EDITOR_REQUESTS,
  AI_PANEL_PATH,
  NODARO_AI_PANEL_CLOSE,
  NODARO_AI_PANEL_INIT,
  NODARO_AI_PANEL_LAYOUT,
  NODARO_AI_PANEL_READY,
  aiPanelOffered,
  createAiPanelRelay,
  routeAiPanelMessage,
  type AiPanelRelayContext,
} from "../freecut-ai-panel.js"
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
} from "../freecut-protocol.js"

const PANEL_ORIGIN = "https://app.nodaro.ai"
const EDITOR_ORIGIN = "https://freecut.nodaro.ai"
const panel = { name: "panel" }
const editor = { name: "editor" }
const context = (asked = new Set<string>()): AiPanelRelayContext => ({ panel, panelOrigin: PANEL_ORIGIN, editor, editorOrigin: EDITOR_ORIGIN, asked })
const fromPanel = (data: unknown) => ({ data, origin: PANEL_ORIGIN, source: panel })
const fromEditor = (data: unknown) => ({ data, origin: EDITOR_ORIGIN, source: editor })

describe("the Edit with AI frame protocol", () => {
  it("pins the wire strings a host and the panel share", () => {
    expect({
      AI_PANEL_PATH,
      NODARO_AI_PANEL_READY,
      NODARO_AI_PANEL_CLOSE,
      NODARO_AI_PANEL_LAYOUT,
      NODARO_AI_PANEL_INIT,
      NODARO_GET_TIMELINE,
      NODARO_APPLY_OPS,
      NODARO_UNDO_EDIT,
      NODARO_PLAYBACK,
      NODARO_PRESENCE,
      FREECUT_TIMELINE,
      FREECUT_OPS_RESULT,
      FREECUT_UNDO_RESULT,
    }).toEqual({
      AI_PANEL_PATH: "/embed/edit-with-ai",
      NODARO_AI_PANEL_READY: "NODARO_AI_PANEL_READY",
      NODARO_AI_PANEL_CLOSE: "NODARO_AI_PANEL_CLOSE",
      NODARO_AI_PANEL_LAYOUT: "NODARO_AI_PANEL_LAYOUT",
      NODARO_AI_PANEL_INIT: "NODARO_AI_PANEL_INIT",
      NODARO_GET_TIMELINE: "NODARO_GET_TIMELINE",
      NODARO_APPLY_OPS: "NODARO_APPLY_OPS",
      NODARO_UNDO_EDIT: "NODARO_UNDO_EDIT",
      NODARO_PLAYBACK: "NODARO_PLAYBACK",
      NODARO_PRESENCE: "NODARO_PRESENCE",
      FREECUT_TIMELINE: "FREECUT_TIMELINE",
      FREECUT_OPS_RESULT: "FREECUT_OPS_RESULT",
      FREECUT_UNDO_RESULT: "FREECUT_UNDO_RESULT",
    })
    expect(AI_PANEL_EDITOR_REQUESTS).toEqual(["NODARO_GET_TIMELINE", "NODARO_APPLY_OPS", "NODARO_UNDO_EDIT", "NODARO_IMPORT_FILES", "NODARO_PLAYBACK", "NODARO_PRESENCE"])
    expect(AI_PANEL_EDITOR_ANSWERS).toEqual(["FREECUT_TIMELINE", "FREECUT_OPS_RESULT", "FREECUT_UNDO_RESULT"])
  })

  it("is offered only on an editor that can be edited, read, played and shown presence", () => {
    expect(aiPanelOffered(["edit-ops", "timeline-read", "playback", "presence", "timeline-add"])).toBe(true)
    expect(aiPanelOffered(["edit-ops", "timeline-read", "playback"])).toBe(false)
    expect(aiPanelOffered([])).toBe(false)
  })
})

describe("routeAiPanelMessage", () => {
  it("carries each of the panel's editor requests to the editor, as sent", () => {
    for (const type of AI_PANEL_EDITOR_REQUESTS) {
      const payload = { requestId: `r-${type}`, label: "Cut the pauses" }
      expect(routeAiPanelMessage(fromPanel({ type, payload }), context())).toEqual({ to: "editor", message: { type, payload }, transfer: [] })
    }
  })

  it("hands an import's buffers over again", () => {
    const buffer = new ArrayBuffer(8)
    const payload = { files: [{ ref: "ai-music-1", name: "ai-music.mp3", type: "audio/mpeg", size: 8, buffer }] }
    const route = routeAiPanelMessage(fromPanel({ type: NODARO_IMPORT_FILES, payload }), context())
    expect(route?.to).toBe("editor")
    expect(route?.transfer).toEqual([buffer])
    expect(route?.transfer[0]).toBe(buffer)
  })

  it("passes back an answer to a request the panel made, once", () => {
    const ctx = context()
    routeAiPanelMessage(fromPanel({ type: NODARO_GET_TIMELINE, payload: { requestId: "r1" } }), ctx)
    const answer = { type: FREECUT_TIMELINE, payload: { requestId: "r1", timeline: { items: [] } } }
    expect(routeAiPanelMessage(fromEditor(answer), ctx)).toEqual({ to: "panel", message: answer, transfer: [] })
    expect(routeAiPanelMessage(fromEditor(answer), ctx)).toBeNull()
  })

  it("never passes the host's own answers to the panel", () => {
    // The host asked for this one itself (its own requestId), and the panel never did.
    const answer = { type: FREECUT_OPS_RESULT, payload: { requestId: "host-1", ok: true } }
    expect(routeAiPanelMessage(fromEditor(answer), context())).toBeNull()
    expect(routeAiPanelMessage(fromEditor({ type: "FREECUT_TIMELINE_ADDED", payload: { requestId: "host-2" } }), context(new Set(["host-2"])))).toBeNull()
  })

  it("leaves alone what is not the panel's: other types, other frames, other origins", () => {
    expect(routeAiPanelMessage(fromPanel({ type: "NODARO_LOAD_VIDEO", payload: {} }), context())).toBeNull()
    expect(routeAiPanelMessage(fromPanel({ type: "NODARO_RESET_PROJECT", payload: {} }), context())).toBeNull()
    expect(routeAiPanelMessage({ data: { type: NODARO_APPLY_OPS, payload: {} }, origin: "https://evil.example", source: panel }, context())).toBeNull()
    expect(routeAiPanelMessage({ data: { type: NODARO_APPLY_OPS, payload: {} }, origin: PANEL_ORIGIN, source: { other: true } }, context())).toBeNull()
    const asked = new Set(["r1"])
    expect(routeAiPanelMessage({ data: { type: FREECUT_TIMELINE, payload: { requestId: "r1" } }, origin: PANEL_ORIGIN, source: editor }, context(asked))).toBeNull()
    expect(asked.has("r1")).toBe(true)
    expect(routeAiPanelMessage(fromPanel("NODARO_APPLY_OPS"), context())).toBeNull()
    expect(routeAiPanelMessage(fromPanel(null), context())).toBeNull()
  })

  it("does not route for a frame that is gone", () => {
    const gone: AiPanelRelayContext = { ...context(), panel: null }
    expect(routeAiPanelMessage({ data: { type: NODARO_PLAYBACK, payload: { action: "play" } }, origin: PANEL_ORIGIN, source: null }, gone)).toBeNull()
  })
})

describe("createAiPanelRelay", () => {
  it("posts requests to the editor and answers to the panel, each on its own origin, until disposed", () => {
    let listener: ((event: MessageEvent) => void) | null = null
    const host = {
      addEventListener: vi.fn((_type: "message", fn: (event: MessageEvent) => void) => {
        listener = fn
      }),
      removeEventListener: vi.fn(),
    }
    const panelWindow = { postMessage: vi.fn() }
    const editorWindow = { postMessage: vi.fn() }
    const relay = createAiPanelRelay({ host, panel: () => panelWindow, panelOrigin: PANEL_ORIGIN, editor: () => editorWindow, editorOrigin: EDITOR_ORIGIN })
    const send = (data: unknown, origin: string, source: unknown) => listener!({ data, origin, source } as MessageEvent)

    send({ type: NODARO_APPLY_OPS, payload: { requestId: "r9", label: "Cut", ops: [] } }, PANEL_ORIGIN, panelWindow)
    expect(editorWindow.postMessage).toHaveBeenCalledWith({ type: NODARO_APPLY_OPS, payload: { requestId: "r9", label: "Cut", ops: [] } }, EDITOR_ORIGIN, [])
    send({ type: FREECUT_OPS_RESULT, payload: { requestId: "r9", ok: true } }, EDITOR_ORIGIN, editorWindow)
    expect(panelWindow.postMessage).toHaveBeenCalledWith({ type: FREECUT_OPS_RESULT, payload: { requestId: "r9", ok: true } }, PANEL_ORIGIN, [])

    relay.dispose()
    expect(host.removeEventListener).toHaveBeenCalledWith("message", listener)
  })
})
