import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { VoiceChangerProConfig } from "../audio-configs"
import type { VoiceChangerProData } from "@/types/nodes"

// VoiceBrowser is exercised elsewhere; stub it to a button that adds a voice.
// The compact variant (used inline on keep-slot rows) is labeled differently
// so tests can target the top-level "add" browser vs a row's picker.
vi.mock("../voice-browser", () => ({
  VoiceBrowser: ({ onSelect, compact, triggerAriaLabel }: { onSelect: (id: string, n: string, t: string) => void; compact?: boolean; triggerAriaLabel?: string }) => (
    <button aria-label={triggerAriaLabel} onClick={() => onSelect("vX", "Voice X", "premade")}>{compact ? "pick-voice" : "add-voice"}</button>
  ),
}))

// Select mock: flatten options under a native <select> so we can drive it with
// fireEvent.change in jsdom (Radix's Select uses a portal-based listbox that
// can't be exercised reliably). The SelectTrigger's aria-label is forwarded
// onto the native <select> so multiple selects on screen stay distinguishable
// via getByRole("combobox", { name }) / getByLabelText. role="combobox"
// mirrors Radix's a11y exposure.
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      let triggerLabel: string | undefined
      let triggerId: string | undefined
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectContent" || child.props?.__content) {
          React.Children.forEach(child.props?.children, (item: any) => {
            if (item) items.push(item)
          })
        }
        if (child.type?.displayName === "SelectTrigger") {
          triggerLabel = child.props?.["aria-label"]
          triggerId = child.props?.id
        }
      })
      return (
        <select
          role="combobox"
          id={triggerId}
          aria-label={triggerLabel}
          value={value ?? ""}
          onChange={(e: any) => onValueChange?.(e.target.value)}
        >
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, {
      displayName: "SelectContent",
    }),
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
    SelectTrigger: Object.assign(
      ({ children }: any) => <>{children}</>,
      { displayName: "SelectTrigger" },
    ),
    SelectValue: () => null,
  }
})

const baseData: VoiceChangerProData = {
  label: "Voice Changer Pro", orderedVoices: [], model: "eleven_english_sts_v2",
  preserveBackground: true, removeBackgroundNoise: false, fieldMappings: {},
}

function renderPanel(over: Partial<VoiceChangerProData> = {}, onUpdate = vi.fn()) {
  const data: VoiceChangerProData = { ...baseData, ...over }
  render(
    <VoiceChangerProConfig
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

describe("VoiceChangerProConfig", () => {
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

  it("renders per-voice settings controls for each voice", () => {
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    })
    // Two voices → two of each per-voice control (default values shown in labels).
    expect(screen.getAllByLabelText(/Stability \(0.5\)/)).toHaveLength(2)
    expect(screen.getAllByLabelText(/Similarity \(0.75\)/)).toHaveLength(2)
    expect(screen.getAllByLabelText(/Style Exaggeration \(0\)/)).toHaveLength(2)
    expect(screen.getAllByLabelText(/Speaker Boost/)).toHaveLength(2)
    // Each voice has a volume-mode control...
    expect(screen.getAllByLabelText(/Volume mode for speaker/)).toHaveLength(2)
    // ...but the manual Volume slider is hidden by default (mode defaults to "match").
    expect(screen.queryByLabelText(/Volume \(/)).not.toBeInTheDocument()
  })

  it("updates stability for the right voice index immutably", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    }, onUpdate)
    // Change the SECOND voice's stability slider.
    fireEvent.change(screen.getAllByLabelText(/Stability/)[1], { target: { value: "0.8" } })
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade", stability: 0.8 },
      ],
    })
  })

  it("defaults the volume mode to 'match' and hides the slider", () => {
    renderPanel({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade" }],
    })
    const mode = screen.getByLabelText(/Volume mode for speaker 1/) as HTMLSelectElement
    expect(mode.value).toBe("match")
    expect(screen.queryByLabelText(/Volume \(/)).not.toBeInTheDocument()
  })

  it("writes the chosen volume mode immutably for the right voice", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    }, onUpdate)
    fireEvent.change(screen.getAllByLabelText(/Volume mode for speaker/)[1], { target: { value: "normalize" } })
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade", volumeMode: "normalize" },
      ],
    })
  })

  it("reveals the manual Volume slider only when mode is 'manual'", () => {
    // Match: no slider.
    const { unmount } = render(
      <VoiceChangerProConfig
        data={{ ...baseData, orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "match" }] }}
        onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
      />,
    )
    expect(screen.queryByLabelText(/Volume \(/)).not.toBeInTheDocument()
    unmount()

    // Normalize: still no slider.
    const r2 = render(
      <VoiceChangerProConfig
        data={{ ...baseData, orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "normalize" }] }}
        onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
      />,
    )
    expect(screen.queryByLabelText(/Volume \(/)).not.toBeInTheDocument()
    r2.unmount()

    // Manual: slider appears with default 100%.
    render(
      <VoiceChangerProConfig
        data={{ ...baseData, orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "manual" }] }}
        onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
      />,
    )
    expect(screen.getByLabelText(/Volume \(100%\)/)).toBeInTheDocument()
  })

  it("updates manual volume and speaker boost for the right voice", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "manual" }],
    }, onUpdate)
    fireEvent.change(screen.getByLabelText(/Volume \(/), { target: { value: "150" } })
    expect(onUpdate).toHaveBeenLastCalledWith({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "manual", volume: 150 }],
    })
    // Speaker Boost defaults to true; toggling off should write false.
    fireEvent.click(screen.getByLabelText(/Speaker Boost/))
    expect(onUpdate).toHaveBeenLastCalledWith({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "manual", useSpeakerBoost: false }],
    })
  })

  it("does not mutate the original orderedVoices array when updating a voice", () => {
    const onUpdate = vi.fn()
    const original = [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade" as const }]
    renderPanel({ orderedVoices: original }, onUpdate)
    fireEvent.change(screen.getByLabelText(/Style Exaggeration/), { target: { value: "0.5" } })
    // Original entry must be untouched (immutability).
    expect(original[0]).toEqual({ voiceId: "v1", voiceLabel: "One", voiceType: "premade" })
    const arg = onUpdate.mock.calls[0][0].orderedVoices
    expect(arg).not.toBe(original)
    expect(arg[0]).not.toBe(original[0])
  })

  // Keep-slot: a null entry means "keep this speaker's original voice"
  // (cloud-plugins orderedVoices contract). The per-voice row must render a
  // "Keep original" label and hide the (inapplicable) settings drawer instead
  // of crashing on `v.voiceLabel` / `v.stability` etc.
  it("renders 'Keep original' for a null slot without crashing, and hides its settings", () => {
    renderPanel({
      orderedVoices: [
        null,
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    })
    expect(screen.getByText(/Speaker 1/)).toBeInTheDocument()
    expect(screen.getByText("Keep original")).toBeInTheDocument()
    expect(screen.getByText(/Speaker 2/)).toBeInTheDocument()
    expect(screen.getByText("Two")).toBeInTheDocument()
    // A keep-slot has nothing to configure — only the real voice gets a
    // "Voice settings" drawer.
    expect(screen.getAllByText("Voice settings")).toHaveLength(1)
  })

  it("removes a null keep-slot by index like any other voice", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        null,
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    }, onUpdate)
    fireEvent.click(screen.getAllByLabelText("Remove voice")[0])
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [{ voiceId: "v2", voiceLabel: "Two", voiceType: "premade" }],
    })
  })

  it("reorders a null keep-slot with a real voice positionally", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
        null,
      ],
    }, onUpdate)
    fireEvent.click(screen.getAllByLabelText("Move up")[1])
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [
        null,
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
      ],
    })
  })

  // ----- Keep-slot creation controls ---------------------------------------

  it("appends a null keep-slot via the 'Keep original' add button", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade" }],
    }, onUpdate)
    fireEvent.click(screen.getByLabelText("Add keep-original slot"))
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade" }, null],
    })
  })

  it("converts a voice row to a keep-slot in place (settings discarded)", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [
        { voiceId: "v1", voiceLabel: "One", voiceType: "premade", stability: 0.8 },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    }, onUpdate)
    fireEvent.click(screen.getByLabelText("Keep original for speaker 1"))
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [null, { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" }],
    })
  })

  it("fills a keep-slot with a picked voice in place", () => {
    const onUpdate = vi.fn()
    renderPanel({
      orderedVoices: [null, { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" }],
    }, onUpdate)
    // The keep row hosts its own compact VoiceBrowser with a per-row accessible
    // name (mocked to forward triggerAriaLabel onto the button).
    fireEvent.click(screen.getByLabelText("Choose voice for speaker 1"))
    expect(onUpdate).toHaveBeenCalledWith({
      orderedVoices: [
        { voiceId: "vX", voiceLabel: "Voice X", voiceType: "premade" },
        { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
      ],
    })
  })

  it("shows the keep-convert button only on voice rows", () => {
    renderPanel({
      orderedVoices: [null, { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" }],
    })
    // One voice row → exactly one convert button (the keep row has none).
    expect(screen.getAllByLabelText(/Keep original for speaker/)).toHaveLength(1)
    expect(screen.getByLabelText("Keep original for speaker 2")).toBeInTheDocument()
  })

  it("defaults separation quality to 'fast' and updates on change", () => {
    const onUpdate = vi.fn()
    renderPanel({}, onUpdate)
    const sep = screen.getByLabelText(/Separation quality/) as HTMLSelectElement
    expect(sep.value).toBe("fast")
    fireEvent.change(sep, { target: { value: "best" } })
    expect(onUpdate).toHaveBeenCalledWith({ separationQuality: "best" })
  })

  it("shows the 'under evaluation' hint under Remove background noise", () => {
    renderPanel({})
    expect(screen.getByText(/Under evaluation/i)).toBeInTheDocument()
  })

  it("shows the Speaker Boost explanation hint", () => {
    renderPanel({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade" }],
    })
    expect(
      screen.getByText(/Boosts the recast.s fidelity to the target voice/i),
    ).toBeInTheDocument()
  })

  // ----- Feature: node-level Music volume ----------------------------------

  describe("Music volume control", () => {
    it("defaults the music volume mode to 'match' and hides the slider", () => {
      renderPanel({})
      const mode = screen.getByLabelText(/Music volume mode/) as HTMLSelectElement
      expect(mode.value).toBe("match")
      expect(screen.queryByLabelText(/Music level \(/)).not.toBeInTheDocument()
    })

    it("writes the chosen music volume mode immutably", () => {
      const onUpdate = vi.fn()
      renderPanel({}, onUpdate)
      fireEvent.change(screen.getByLabelText(/Music volume mode/), { target: { value: "normalize" } })
      expect(onUpdate).toHaveBeenCalledWith({ musicVolumeMode: "normalize" })
    })

    it("reveals the music level slider only when mode is 'manual'", () => {
      // Match: no slider.
      const { unmount } = render(
        <VoiceChangerProConfig
          data={{ ...baseData, musicVolumeMode: "match" }}
          onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
        />,
      )
      expect(screen.queryByLabelText(/Music level \(/)).not.toBeInTheDocument()
      unmount()

      // Normalize: still no slider.
      const r2 = render(
        <VoiceChangerProConfig
          data={{ ...baseData, musicVolumeMode: "normalize" }}
          onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
        />,
      )
      expect(screen.queryByLabelText(/Music level \(/)).not.toBeInTheDocument()
      r2.unmount()

      // Manual: slider appears with default 100%.
      render(
        <VoiceChangerProConfig
          data={{ ...baseData, musicVolumeMode: "manual" }}
          onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
        />,
      )
      expect(screen.getByLabelText(/Music level \(100%\)/)).toBeInTheDocument()
    })

    it("updates the manual music level immutably (no other fields touched)", () => {
      const onUpdate = vi.fn()
      renderPanel({ musicVolumeMode: "manual" }, onUpdate)
      fireEvent.change(screen.getByLabelText(/Music level \(/), { target: { value: "150" } })
      expect(onUpdate).toHaveBeenCalledWith({ musicVolume: 150 })
    })

    it("hides the music volume control when background music is not preserved", () => {
      renderPanel({ preserveBackground: false })
      expect(screen.queryByLabelText(/Music volume mode/)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Music level \(/)).not.toBeInTheDocument()
    })
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

  // ----- Feature 1: per-voice Seed -----------------------------------------

  describe("per-voice Seed", () => {
    it("renders one Seed input per voice, blank by default", () => {
      renderPanel({
        orderedVoices: [
          { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
          { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
        ],
      })
      const seeds = screen.getAllByLabelText("Seed") as HTMLInputElement[]
      expect(seeds).toHaveLength(2)
      expect(seeds[0].value).toBe("")
      expect(seeds[1].value).toBe("")
    })

    it("writes seed for the right voice index immutably", () => {
      const onUpdate = vi.fn()
      renderPanel({
        orderedVoices: [
          { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
          { voiceId: "v2", voiceLabel: "Two", voiceType: "premade" },
        ],
      }, onUpdate)
      // Set the SECOND voice's seed.
      fireEvent.change(screen.getAllByLabelText("Seed")[1], { target: { value: "42" } })
      expect(onUpdate).toHaveBeenCalledWith({
        orderedVoices: [
          { voiceId: "v1", voiceLabel: "One", voiceType: "premade" },
          { voiceId: "v2", voiceLabel: "Two", voiceType: "premade", seed: 42 },
        ],
      })
    })

    it("treats 0 as an explicit seed (not unset)", () => {
      const onUpdate = vi.fn()
      renderPanel({
        orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade" }],
      }, onUpdate)
      fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "0" } })
      expect(onUpdate).toHaveBeenLastCalledWith({
        orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", seed: 0 }],
      })
    })

    it("clears the seed (unset) when the input is emptied", () => {
      const onUpdate = vi.fn()
      renderPanel({
        orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", seed: 123 }],
      }, onUpdate)
      const input = screen.getByLabelText("Seed") as HTMLInputElement
      expect(input.value).toBe("123")
      fireEvent.change(input, { target: { value: "" } })
      expect(onUpdate).toHaveBeenLastCalledWith({
        orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", seed: undefined }],
      })
    })
  })

  // ----- Feature 2: node-level Voice FX ------------------------------------

  describe("Voice FX section", () => {
    it("defaults the preset select to None and shows the voice-targeted hint", () => {
      renderPanel({})
      const fx = screen.getByLabelText("Voice FX") as HTMLSelectElement
      expect(fx.value).toBe("__none__")
      expect(
        screen.getByText(/before the background music is mixed back/i),
      ).toBeInTheDocument()
      // No param controls when no preset is selected.
      expect(screen.queryByText(/Wet \/ Dry mix/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Delay \(ms\)/)).not.toBeInTheDocument()
    })

    it("sets voiceFx with a reverb preset and reveals wetDryMix only", () => {
      const onUpdate = vi.fn()
      renderPanel({}, onUpdate)
      fireEvent.change(screen.getByLabelText("Voice FX"), { target: { value: "hall" } })
      expect(onUpdate).toHaveBeenCalledWith({ voiceFx: { preset: "hall" } })
    })

    it("reveals wetDryMix (and not delay/decay) for a reverb preset", () => {
      renderPanel({ voiceFx: { preset: "church" } })
      expect(screen.getByText(/Wet \/ Dry mix/)).toBeInTheDocument()
      expect(screen.queryByText(/Delay \(ms\)/)).not.toBeInTheDocument()
      expect(screen.queryByText(/^Decay/)).not.toBeInTheDocument()
    })

    it("reveals delay + decay (and not wetDryMix) for the echo preset", () => {
      renderPanel({ voiceFx: { preset: "echo" } })
      expect(screen.getByText(/Delay \(ms\)/)).toBeInTheDocument()
      expect(screen.getByText(/Decay/)).toBeInTheDocument()
      expect(screen.queryByText(/Wet \/ Dry mix/)).not.toBeInTheDocument()
    })

    it("reveals delay + decay for the custom preset", () => {
      renderPanel({ voiceFx: { preset: "custom" } })
      expect(screen.getByText(/Delay \(ms\)/)).toBeInTheDocument()
      expect(screen.getByText(/Decay/)).toBeInTheDocument()
    })

    it("clears voiceFx when None is selected", () => {
      const onUpdate = vi.fn()
      renderPanel({ voiceFx: { preset: "hall", wetDryMix: 50 } }, onUpdate)
      fireEvent.change(screen.getByLabelText("Voice FX"), { target: { value: "__none__" } })
      expect(onUpdate).toHaveBeenCalledWith({ voiceFx: undefined })
    })

    it("preserves existing params when switching to another preset of the same family", () => {
      const onUpdate = vi.fn()
      renderPanel({ voiceFx: { preset: "hall", wetDryMix: 70 } }, onUpdate)
      fireEvent.change(screen.getByLabelText("Voice FX"), { target: { value: "church" } })
      expect(onUpdate).toHaveBeenCalledWith({ voiceFx: { preset: "church", wetDryMix: 70 } })
    })
  })
})
