import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { VoiceRecastConfig } from "../audio-configs"
import type { VoiceRecastData } from "@/types/nodes"

// VoiceBrowser is exercised elsewhere; stub it to a button that adds a voice.
vi.mock("../voice-browser", () => ({
  VoiceBrowser: ({ onSelect }: { onSelect: (id: string, n: string, t: string) => void }) => (
    <button onClick={() => onSelect("vX", "Voice X", "premade")}>add-voice</button>
  ),
}))

const baseData: VoiceRecastData = {
  label: "Voice Recast", orderedVoices: [], model: "eleven_english_sts_v2",
  preserveBackground: true, removeBackgroundNoise: false, fieldMappings: {},
}

function renderPanel(over: Partial<VoiceRecastData> = {}, onUpdate = vi.fn()) {
  const data: VoiceRecastData = { ...baseData, ...over }
  render(
    <VoiceRecastConfig
      data={data}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />
  )
  return { onUpdate }
}

describe("VoiceRecastConfig", () => {
  it("appends a picked voice to orderedVoices (immutably)", () => {
    const onUpdate = vi.fn()
    renderPanel({}, onUpdate)
    fireEvent.click(screen.getByText("add-voice"))
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [{ voiceId: "vX", voiceLabel: "Voice X", voiceType: "premade" }],
    })
  })

  it("removes a voice by index", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    }, onUpdate)
    fireEvent.click(screen.getAllByLabelText("Remove voice")[0])
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [{ voiceId: "v2", voiceLabel: "Two", voiceType: "premade" }],
    })
  })

  it("shows the speaker-order hint with one row per voice", () => {
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    })
    expect(screen.getByText(/Speaker 1/)).toBeInTheDocument()
    expect(screen.getByText(/Speaker 2/)).toBeInTheDocument()
  })

  it("reorders voices and respects bounds", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    }, onUpdate)

    // Click "Move down" on the first row — should swap v1 and v2
    fireEvent.click(screen.getAllByLabelText("Move down")[0])
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
      ],
    })
    const firstCallCount = onUpdate.mock.calls.length
    expect(firstCallCount).toBe(1)

    // Click "Move up" on the first row (index 0) — should be a no-op (can't move up from top)
    fireEvent.click(screen.getAllByLabelText("Move up")[0])
    // Either no additional call or the call count should not increase
    expect(onUpdate.mock.calls.length).toBe(firstCallCount)
  })
})
