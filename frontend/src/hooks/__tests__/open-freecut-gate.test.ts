import { describe, it, expect, afterEach } from "vitest"
import { useWorkflowStore } from "../use-workflow-store"

/**
 * `openFreeCut` opens the embedded video editor on a node's video. It is the
 * backstop behind every "Edit video" action: on an install whose editor is
 * switched off (`FREECUT_URL=off`) it opens nothing, so no shell is drawn
 * around a frame that cannot load (#767).
 */

const VIDEO = "https://cdn.example/out/clip.mp4"
const PROJECT = "https://cdn.example/out/clip.freecut.json"

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  useWorkflowStore.getState().closeFreeCut()
})

describe("openFreeCut", () => {
  it("opens the editor on an install that sets nothing (the hosted editor)", () => {
    window.__NODARO_RUNTIME__ = {}
    useWorkflowStore.getState().openFreeCut("N1", VIDEO, PROJECT)
    expect(useWorkflowStore.getState().freecutEdit).toEqual({ nodeId: "N1", videoUrl: VIDEO, freecutProjectUrl: PROJECT })
  })

  it("opens the editor an operator configured", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "https://freecut.example.internal" }
    useWorkflowStore.getState().openFreeCut("N1", VIDEO)
    expect(useWorkflowStore.getState().freecutEdit).toEqual({ nodeId: "N1", videoUrl: VIDEO, freecutProjectUrl: undefined })
  })

  it.each(["off", "none", "false", "disabled"])("opens nothing when FREECUT_URL is %j", (value) => {
    window.__NODARO_RUNTIME__ = { freecutUrl: value }
    useWorkflowStore.getState().openFreeCut("N1", VIDEO, PROJECT)
    expect(useWorkflowStore.getState().freecutEdit).toBeNull()
  })
})
