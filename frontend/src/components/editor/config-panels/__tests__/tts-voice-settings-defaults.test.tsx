import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TtsVoiceSettings } from "../tts-voice-settings"
import { translate } from "@/lib/i18n"

// The panel must read the node's voice-setting defaults from their one source. Swap the source for values no
// literal in the panel could match: a node with no saved settings must show exactly these.
vi.mock("@/types/nodes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/types/nodes")>()),
  TTS_VOICE_SETTING_DEFAULTS: { speed: 0.95, stability: 0.15, similarityBoost: 0.85, style: 0.35 },
}))

const slider = (key: Parameters<typeof translate>[1]) =>
  screen.getByLabelText(new RegExp(translate("en", key))) as HTMLInputElement

describe("TtsVoiceSettings — a node saved without its voice settings", () => {
  it("shows the node's defaults from TTS_VOICE_SETTING_DEFAULTS, on every lever", () => {
    render(<TtsVoiceSettings provider="elevenlabs-turbo" data={{}} onUpdate={() => {}} />)
    expect(Number(slider("field.stability").value)).toBeCloseTo(0.15, 5)
    expect(Number(slider("audiocfg.similarity").value)).toBeCloseTo(0.85, 5)
    expect(Number(slider("audiocfg.styleExaggeration").value)).toBeCloseTo(0.35, 5)
    expect(Number(slider("audiocfg.speed").value)).toBeCloseTo(0.95, 5)
    // Each label's readout, e.g. "Stability (0.15)".
    for (const readout of [/\(0\.15\)/, /\(0\.85\)/, /\(0\.35\)/, /\(0\.95\)/]) expect(screen.getByText(readout)).toBeInTheDocument()
  })

  it("a saved value still wins over the default", () => {
    render(<TtsVoiceSettings provider="elevenlabs-turbo" data={{ stability: 0.4 }} onUpdate={() => {}} />)
    expect(Number(slider("field.stability").value)).toBeCloseTo(0.4, 5)
  })
})
