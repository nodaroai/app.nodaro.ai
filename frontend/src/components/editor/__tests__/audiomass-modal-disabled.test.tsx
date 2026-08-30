import { describe, it, expect, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"

import { AudiomassEditorModal } from "../audiomass-editor-modal"

/**
 * The presentation / app-runner surface mounts this modal from its own state and
 * never goes through the tab-mode guard in handleEditNode. An `<iframe src="">`
 * loads the PARENT document — the app rendering itself inside its own editor —
 * so the guard has to live in the modal too, where every caller passes through
 * (mirrors FreeCutEditorModal, #767 review). With no hosted default, an
 * unconfigured install is the DISABLED state by default.
 */
// The modal renders through createPortal, so it lands in document.body and never
// in the RTL container — querying the container would make these vacuous.
const renderModal = () =>
  render(
    <AudiomassEditorModal
      audioUrl="http://localhost:3000/storage/nodaro-assets/audio/x.mp3"
      onExportComplete={async () => {}}
      onClose={() => {}}
    />,
  )

describe("AudiomassEditorModal with no editor configured", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("renders no iframe at all rather than one with an empty src (explicit off)", () => {
    window.__NODARO_RUNTIME__ = { audiomassUrl: "off" }
    renderModal()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("renders no iframe when nothing is configured (no hosted default)", () => {
    renderModal()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("says why the editor is absent", () => {
    window.__NODARO_RUNTIME__ = { audiomassUrl: "off" }
    renderModal()
    expect(screen.getByText(/no audio editor is configured/i)).toBeTruthy()
  })

  it("frames the configured editor when one exists", () => {
    window.__NODARO_RUNTIME__ = { audiomassUrl: "https://audiomass.example.internal" }
    renderModal()
    const iframe = document.querySelector("iframe")
    expect(iframe?.getAttribute("src")).toBe("https://audiomass.example.internal")
  })
})
