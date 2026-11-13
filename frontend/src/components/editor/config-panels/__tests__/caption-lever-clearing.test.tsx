import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AddCaptionsConfig } from "../processing-configs"
import type { AddCaptionsData } from "@/types/nodes"

/**
 * On a plain-text `subtitle` a styling lever is not just a look: ANY of them
 * (look / font family / weight / stroke colour / stroke width / uppercase /
 * vertical position / max words per line) moves the render from the FFmpeg burn
 * to Remotion, and the price with it. So a lever the user turned back OFF must
 * be UNSET in node data, not persisted as a value that changes nothing: a stored
 * `uppercase: false` on a plain subtitle buys the pricier renderer for no
 * visible difference.
 */

function renderConfig(data: Partial<AddCaptionsData>) {
  const onUpdate = vi.fn()
  render(
    <AddCaptionsConfig
      data={{ label: "Captions", style: "subtitle", position: "bottom", fontSize: 32, color: "#ffffff", fieldMappings: {}, ...data } as AddCaptionsData}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[]}
    />,
  )
  return onUpdate
}

describe("clearing a caption styling lever leaves it UNSET", () => {
  it("uppercase back at the look's own casing is written as undefined, not false", () => {
    const onUpdate = renderConfig({ uppercase: true })
    fireEvent.click(screen.getByLabelText(/uppercase/i))
    expect(onUpdate).toHaveBeenCalledWith({ uppercase: undefined })
  })

  it("turning uppercase ON is still an explicit lever", () => {
    const onUpdate = renderConfig({})
    fireEvent.click(screen.getByLabelText(/uppercase/i))
    expect(onUpdate).toHaveBeenCalledWith({ uppercase: true })
  })

  it("an emptied max-words field clears the lever rather than writing 0 or NaN", () => {
    const onUpdate = renderConfig({ maxWordsPerLine: 3 })
    fireEvent.change(screen.getByLabelText(/max words/i), { target: { value: "" } })
    expect(onUpdate).toHaveBeenCalledWith({ maxWordsPerLine: undefined })
  })

  // A colour input has no empty state, so a touched outline colour would stay a
  // lever for good — invisible on a subtitle whose look draws no outline, yet
  // routing it to Remotion. Auto hands the colour back to the look.
  it("a set outline colour offers Auto, which UNSETS it", () => {
    const onUpdate = renderConfig({ strokeColor: "#000000" })
    fireEvent.click(screen.getByLabelText(/outline color back to the look/i))
    expect(onUpdate).toHaveBeenCalledWith({ strokeColor: undefined })
  })

  it("an unset outline colour offers no Auto (nothing to hand back)", () => {
    renderConfig({})
    expect(screen.queryByLabelText(/outline color back to the look/i)).toBeNull()
  })

  it("a kinetic style's set spoken-word colour offers Auto too", () => {
    const onUpdate = renderConfig({ style: "word-highlight", highlightColor: "#FFE600" })
    fireEvent.click(screen.getByLabelText(/spoken word color back to the look/i))
    expect(onUpdate).toHaveBeenCalledWith({ highlightColor: undefined })
  })
})

/**
 * Font size was the one caption control that could still author a value the
 * route refuses (`min={8}` + a raw parseInt against a 12–200 Zod), so the canvas
 * 400'd on a node the orchestrator silently renders at 12.
 */
describe("the font size field", () => {
  it("advertises the wire's bounds", () => {
    renderConfig({})
    const input = screen.getByLabelText(/font size/i)
    expect(input).toHaveAttribute("min", "12")
    expect(input).toHaveAttribute("max", "200")
  })

  it("settles a below-floor value on commit instead of sending it to the route", () => {
    const onUpdate = renderConfig({ fontSize: 10 })
    fireEvent.blur(screen.getByLabelText(/font size/i), { target: { value: "10" } })
    expect(onUpdate).toHaveBeenCalledWith({ fontSize: 12 })
  })

  it("holds the ceiling while typing", () => {
    const onUpdate = renderConfig({})
    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "900" } })
    expect(onUpdate).toHaveBeenCalledWith({ fontSize: 200 })
  })
})

/**
 * The panel's engine control (decided 2026-11-13): Add Captions' own engines,
 * Nemotron 3.5 Transcribe among them with its per-minute price said, shown only
 * while the node may auto-transcribe.
 */
describe("the transcription engine", () => {
  it("is offered while the node may auto-transcribe, and hidden when it may not", () => {
    renderConfig({})
    expect(screen.getByLabelText(/transcription engine/i)).toBeInTheDocument()
  })

  it("is hidden when auto-transcription is off", () => {
    renderConfig({ autoTranscribe: false })
    expect(screen.queryByLabelText(/transcription engine/i)).toBeNull()
  })

  it("is hidden on a subtitle that burns its own text (it never transcribes)", () => {
    renderConfig({ style: "subtitle", text: "Hello there" })
    expect(screen.queryByLabelText(/transcription engine/i)).toBeNull()
  })

  it("stays on a kinetic style with text (the text is only its fallback)", () => {
    renderConfig({ style: "word-highlight", text: "Hello there" })
    expect(screen.getByLabelText(/transcription engine/i)).toBeInTheDocument()
  })

  it("stays on a subtitle whose text is a {Label} reference, which may resolve to nothing", () => {
    renderConfig({ style: "subtitle", text: "{Script}" })
    expect(screen.getByLabelText(/transcription engine/i)).toBeInTheDocument()
  })

  it("says Nemotron is priced per started minute of the video, on top of the render", () => {
    renderConfig({ transcribeProvider: "nemotron-3-5-transcribe" })
    expect(screen.getByText(/per started minute of the video/i)).toBeInTheDocument()
  })

  it("says nothing of the minutes on another engine", () => {
    renderConfig({ transcribeProvider: "elevenlabs-stt" })
    expect(screen.queryByText(/per started minute of the video/i)).toBeNull()
  })
})
