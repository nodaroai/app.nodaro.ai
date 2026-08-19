import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@nodaro/shared", () => ({
  NODARO_LOAD_VIDEO: "NODARO_LOAD_VIDEO",
  NODARO_IMPORT_FILES: "NODARO_IMPORT_FILES",
  NODARO_RESET_PROJECT: "NODARO_RESET_PROJECT",
  FREECUT_READY: "FREECUT_READY",
  FREECUT_EXPORT_COMPLETE: "FREECUT_EXPORT_COMPLETE",
  FREECUT_REQUEST_IMPORT: "FREECUT_REQUEST_IMPORT",
}))

import { FreeCutEditorModal } from "../freecut-editor-modal"

/**
 * `openFreeCut` refuses to open without a configured editor, but the
 * presentation / app-runner surface mounts this modal from its own state and
 * never goes through that action. An `<iframe src="">` loads the PARENT
 * document — the app rendering itself inside its own editor — so the guard has
 * to live in the modal, where every caller passes through (#767 review).
 */
// The modal renders through createPortal, so it lands in document.body and
// never in the RTL container — querying the container would make every one of
// these assertions pass vacuously.
const renderModal = () =>
  render(
    <FreeCutEditorModal
      videoUrl="http://localhost:3000/storage/nodaro-assets/videos/x.mp4"
      onExportComplete={async () => {}}
      onClose={() => {}}
    />,
  )

describe("FreeCutEditorModal with no editor configured", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("renders no iframe at all rather than one with an empty src", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "off" }
    renderModal()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("says why the editor is absent", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "off" }
    renderModal()
    expect(screen.getByText(/no video editor is configured/i)).toBeTruthy()
  })

  it("frames the configured editor when one exists", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "https://freecut.example.internal" }
    renderModal()
    const iframe = document.querySelector("iframe")
    expect(iframe?.getAttribute("src")).toBe("https://freecut.example.internal")
  })

  it("never renders an iframe whose src would resolve to this app", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "off" }
    renderModal()
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      expect(frame.getAttribute("src")).toBeTruthy()
    }
  })
})
