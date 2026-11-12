import { describe, it, expect, afterEach, vi } from "vitest"
import { render } from "@testing-library/react"

// Keep the real module (the i18n layer reads LANGUAGES from it) and pin only
// the message constants this test cares about.
vi.mock("@nodaro/shared/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/media")>()),
  NODARO_LOAD_VIDEO: "NODARO_LOAD_VIDEO",
  FREECUT_READY: "FREECUT_READY",
}))

import { FreeCutEditorModal } from "../freecut-editor-modal"

const EDITOR = "https://freecut.example.internal"
const VIDEO = "https://cdn.example.internal/videos/x.mp4"

/**
 * The workflow editor keeps an edit as a new video on the node, so it asks the
 * editor's Save & Exit for a rendered video (FREECUT_EXPORT_COMPLETE). Without
 * that, Save & Exit answers with the project JSON alone, which this modal does
 * not save, and the button seems to do nothing.
 */
describe("FreeCutEditorModal asks Save & Exit for the video", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
    vi.unstubAllGlobals()
  })

  it("hands the editor the video with saveExit: video, once it says it is ready", async () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: EDITOR }
    vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })))
    render(<FreeCutEditorModal videoUrl={VIDEO} onExportComplete={async () => {}} onClose={() => {}} />)
    const frame = document.querySelector("iframe") as HTMLIFrameElement
    const post = vi.fn()
    Object.defineProperty(frame.contentWindow, "postMessage", { value: post, configurable: true })

    window.dispatchEvent(new MessageEvent("message", { data: { type: "FREECUT_READY" }, origin: EDITOR, source: frame.contentWindow }))

    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    const [message, targetOrigin] = post.mock.calls[0]
    expect(targetOrigin).toBe(EDITOR)
    expect(message.type).toBe("NODARO_LOAD_VIDEO")
    expect(message.payload.videoUrl).toBe(VIDEO)
    expect(message.payload.saveExit).toBe("video")
  })

  it("hands nothing over for a ready message from any other origin or window", async () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: EDITOR }
    vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })))
    render(<FreeCutEditorModal videoUrl={VIDEO} onExportComplete={async () => {}} onClose={() => {}} />)
    const frame = document.querySelector("iframe") as HTMLIFrameElement
    const post = vi.fn()
    Object.defineProperty(frame.contentWindow, "postMessage", { value: post, configurable: true })

    window.dispatchEvent(new MessageEvent("message", { data: { type: "FREECUT_READY" }, origin: "https://other.example.internal", source: frame.contentWindow }))
    window.dispatchEvent(new MessageEvent("message", { data: { type: "FREECUT_READY" }, origin: EDITOR, source: window }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(post).not.toHaveBeenCalled()
  })
})
