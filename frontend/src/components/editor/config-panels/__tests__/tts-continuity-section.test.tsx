import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TtsContinuitySection } from "../tts-continuity-section"
import { translate } from "@/lib/i18n"

const text = (key: Parameters<typeof translate>[1]) => translate("en", key)
const noop = { sources: [], fieldMappings: {}, onMapField: () => {} }

describe("TtsContinuitySection — shown only for a model that stitches", () => {
  it.each([
    ["elevenlabs-v4", true],
    ["elevenlabs-turbo", true],
    ["elevenlabs-multilingual", true],
    ["elevenlabs-v3", false],
    ["elevenlabs-dialogue", true], // not a text-to-speech model → runs as turbo, whose sheet stitches
  ])("%s → %s", (provider, shown) => {
    render(<TtsContinuitySection provider={provider} data={{}} onUpdate={() => {}} {...noop} />)
    expect(screen.queryByTestId("tts-continuity-toggle") !== null).toBe(shown)
  })

  it("a missing provider follows turbo's sheet (what an omitted provider runs as in the panel's other controls)", async () => {
    const { ttsSupportsStitching } = await import("@nodaro/shared")
    render(<TtsContinuitySection provider={undefined} data={{}} onUpdate={() => {}} {...noop} />)
    expect(screen.queryByTestId("tts-continuity-toggle") !== null).toBe(ttsSupportsStitching(undefined))
  })
})

describe("TtsContinuitySection — collapsed, with a badge, writes only what the user types", () => {
  it("starts collapsed; the badge counts the sides that are set; expanding shows both fields", () => {
    render(<TtsContinuitySection provider="elevenlabs-v4" data={{ previousText: "Before.", nextText: "" }} onUpdate={() => {}} {...noop} />)
    expect(screen.getByTestId("tts-continuity-badge").textContent).toBe(text("audiocfg.continuitySetCount").replace("{count}", "1"))
    expect(screen.queryByPlaceholderText(text("audiocfg.previousTextPh"))).toBeNull()
    fireEvent.click(screen.getByTestId("tts-continuity-toggle"))
    // Queried by placeholder: MappableField's own <Label htmlFor> points at its source-menu trigger id, not at the child.
    expect(screen.getByPlaceholderText(text("audiocfg.previousTextPh"))).toHaveValue("Before.")
    expect(screen.getByPlaceholderText(text("audiocfg.nextTextPh"))).toHaveValue("")
    expect(screen.getByText(text("audiocfg.previousText"))).toBeInTheDocument()
  })

  it("no badge when neither side is set", () => {
    render(<TtsContinuitySection provider="elevenlabs-v4" data={{}} onUpdate={() => {}} {...noop} />)
    expect(screen.queryByTestId("tts-continuity-badge")).toBeNull()
  })

  it("writes the side the user edits, and only that", () => {
    const onUpdate = vi.fn()
    render(<TtsContinuitySection provider="elevenlabs-v4" data={{}} onUpdate={onUpdate} {...noop} />)
    fireEvent.click(screen.getByTestId("tts-continuity-toggle"))
    fireEvent.change(screen.getByPlaceholderText(text("audiocfg.nextTextPh")), { target: { value: "After." } })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ nextText: "After." })
  })

  it("never writes on its own: rendering, expanding, or re-rendering with another model's data calls nothing", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<TtsContinuitySection provider="elevenlabs-v4" data={{ previousText: "Before." }} onUpdate={onUpdate} {...noop} />)
    fireEvent.click(screen.getByTestId("tts-continuity-toggle"))
    rerender(<TtsContinuitySection provider="elevenlabs-v3" data={{ previousText: "Before." }} onUpdate={onUpdate} {...noop} />)
    rerender(<TtsContinuitySection provider="elevenlabs-v4" data={{}} onUpdate={onUpdate} {...noop} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
