import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, render } from "@testing-library/react"

// Keep the real module (the i18n layer reads LANGUAGES from it) and pin only
// the message constants this test sends.
vi.mock("@nodaro/shared/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/media")>()),
  NODARO_LOAD_VIDEO: "NODARO_LOAD_VIDEO",
  NODARO_IMPORT_FILES: "NODARO_IMPORT_FILES",
  NODARO_RESET_PROJECT: "NODARO_RESET_PROJECT",
  FREECUT_READY: "FREECUT_READY",
  FREECUT_EXPORT_COMPLETE: "FREECUT_EXPORT_COMPLETE",
  FREECUT_REQUEST_IMPORT: "FREECUT_REQUEST_IMPORT",
}))

import { FreeCutEditorModal } from "../freecut-editor-modal"
import { AudiomassEditorModal } from "../audiomass-editor-modal"

/**
 * The video and audio editors run in an iframe on their configured origin and
 * report back with `message` events: "ready", an export (the bytes that become
 * the node's result), an import request (which opens a file picker). Another
 * frame on the same origin can post to this window too, so a message is taken
 * only from the editor frame the modal itself opened. Anything else is ignored.
 */
const VIDEO_EDITOR = "https://video-editor.example.test"
const AUDIO_EDITOR = "https://audio-editor.example.test"

const extraFrames: HTMLIFrameElement[] = []

/** Another frame, as a page on the editor's origin could be: a real window that is not the modal's editor. */
function anotherFrame(): Window {
  const frame = document.createElement("iframe")
  document.body.appendChild(frame)
  extraFrames.push(frame)
  return frame.contentWindow!
}

/** The window of the editor frame the modal rendered (it portals into document.body). */
function editorWindow(src: string): Window {
  const frame = document.querySelector<HTMLIFrameElement>(`iframe[src="${src}"]`)
  expect(frame?.contentWindow).toBeTruthy()
  return frame!.contentWindow!
}

/** Deliver a `message` event the way the browser does: `source` is the window that sent it. */
function deliver(data: unknown, origin: string, source: unknown) {
  const event = new MessageEvent("message", { data, origin })
  Object.defineProperty(event, "source", { value: source })
  act(() => {
    window.dispatchEvent(event)
  })
}

beforeEach(() => {
  window.__NODARO_RUNTIME__ = { freecutUrl: VIDEO_EDITOR, audiomassUrl: AUDIO_EDITOR }
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  while (extraFrames.length) extraFrames.pop()!.remove()
})

describe("FreeCutEditorModal takes messages only from its own editor frame", () => {
  const exported = { type: "FREECUT_EXPORT_COMPLETE", payload: { videoBuffer: new ArrayBuffer(4) } }

  it("ignores an export from another frame on the editor's origin, and takes its own", async () => {
    const onExportComplete = vi.fn(async (_blob: Blob, _project?: unknown) => {})
    render(<FreeCutEditorModal videoUrl="https://media.example.test/v.mp4" onExportComplete={onExportComplete} onClose={() => {}} />)

    deliver(exported, VIDEO_EDITOR, anotherFrame())
    expect(onExportComplete).not.toHaveBeenCalled()

    deliver(exported, VIDEO_EDITOR, editorWindow(VIDEO_EDITOR))
    expect(onExportComplete).toHaveBeenCalledTimes(1)
    expect(onExportComplete.mock.calls[0]![0]).toBeInstanceOf(Blob)
  })

  it("ignores an import request from another frame on the editor's origin", () => {
    const onImportRequest = vi.fn()
    render(
      <FreeCutEditorModal
        videoUrl="https://media.example.test/v.mp4"
        onExportComplete={async () => {}}
        onClose={() => {}}
        onImportRequest={onImportRequest}
      />,
    )
    const request = { type: "FREECUT_REQUEST_IMPORT", payload: { accept: "video/*", multiple: false } }

    deliver(request, VIDEO_EDITOR, anotherFrame())
    expect(onImportRequest).not.toHaveBeenCalled()

    deliver(request, VIDEO_EDITOR, editorWindow(VIDEO_EDITOR))
    expect(onImportRequest).toHaveBeenCalledWith("video/*", false)
  })

  it("still ignores its own frame's message from another origin", () => {
    const onExportComplete = vi.fn(async (_blob: Blob, _project?: unknown) => {})
    render(<FreeCutEditorModal videoUrl="https://media.example.test/v.mp4" onExportComplete={onExportComplete} onClose={() => {}} />)

    deliver(exported, "https://attacker.example", editorWindow(VIDEO_EDITOR))
    expect(onExportComplete).not.toHaveBeenCalled()
  })
})

describe("AudiomassEditorModal takes messages only from its own editor frame", () => {
  const exported = { type: "AUDIOMASS_EXPORT_COMPLETE", payload: { audioBuffer: new ArrayBuffer(4), mimeType: "audio/mpeg" } }

  it("ignores an export from another frame on the editor's origin, and takes its own", () => {
    const onExportComplete = vi.fn(async (_blob: Blob) => {})
    render(<AudiomassEditorModal audioUrl="https://media.example.test/a.mp3" onExportComplete={onExportComplete} onClose={() => {}} />)

    deliver(exported, AUDIO_EDITOR, anotherFrame())
    expect(onExportComplete).not.toHaveBeenCalled()

    deliver(exported, AUDIO_EDITOR, editorWindow(AUDIO_EDITOR))
    expect(onExportComplete).toHaveBeenCalledTimes(1)
    expect(onExportComplete.mock.calls[0]![0]).toBeInstanceOf(Blob)
  })

  it("still ignores its own frame's message from another origin", () => {
    const onExportComplete = vi.fn(async (_blob: Blob) => {})
    render(<AudiomassEditorModal audioUrl="https://media.example.test/a.mp3" onExportComplete={onExportComplete} onClose={() => {}} />)

    deliver(exported, "https://attacker.example", editorWindow(AUDIO_EDITOR))
    expect(onExportComplete).not.toHaveBeenCalled()
  })
})
