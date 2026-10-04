import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TtsVoiceSettings } from "../tts-voice-settings"
import { translate } from "@/lib/i18n"

const label = (key: Parameters<typeof translate>[1]) => new RegExp(translate("en", key))

const shown = () => ({
  stability: screen.queryByLabelText(label("field.stability")) !== null,
  similarity: screen.queryByLabelText(label("audiocfg.similarity")) !== null,
  style: screen.queryByLabelText(label("audiocfg.styleExaggeration")) !== null,
  speed: screen.queryByLabelText(label("audiocfg.speed")) !== null,
})

describe("TtsVoiceSettings — only the levers the model honours", () => {
  it.each([
    ["elevenlabs-v3", { stability: true, similarity: false, style: false, speed: false }],
    ["elevenlabs-turbo", { stability: true, similarity: true, style: true, speed: true }],
    ["elevenlabs-multilingual", { stability: true, similarity: true, style: true, speed: true }],
    ["elevenlabs", { stability: true, similarity: true, style: true, speed: true }], // legacy alias runs as turbo
    [undefined, { stability: true, similarity: true, style: true, speed: true }], // turbo's sliders, as before the sheet
    ["elevenlabs-dialogue", { stability: true, similarity: true, style: true, speed: true }], // not a text-to-speech model → turbo's
  ])("%s shows %j", (provider, expected) => {
    render(<TtsVoiceSettings provider={provider} data={{}} onUpdate={() => {}} />)
    expect(shown()).toStrictEqual(expected)
  })

  it("writes the lever the user moves", () => {
    const onUpdate = vi.fn()
    render(<TtsVoiceSettings provider="elevenlabs-turbo" data={{ similarityBoost: 0.75 }} onUpdate={onUpdate} />)
    const slider = screen.getByLabelText(label("audiocfg.similarity")) as HTMLInputElement
    // jsdom range inputs report `change` through the value setter + an input event.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "0.4")
    slider.dispatchEvent(new Event("input", { bubbles: true }))
    expect(onUpdate).toHaveBeenCalledWith({ similarityBoost: 0.4 })
  })

  it("never writes on its own: rendering, or re-rendering with another model's data, calls nothing", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<TtsVoiceSettings provider="elevenlabs-turbo" data={{ speed: 1.15, style: 0.4 }} onUpdate={onUpdate} />)
    rerender(<TtsVoiceSettings provider="elevenlabs-v3" data={{ speed: 1, style: 0, similarityBoost: 0.75 }} onUpdate={onUpdate} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
