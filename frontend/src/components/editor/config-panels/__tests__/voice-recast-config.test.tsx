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

const baseData: VoiceRecastData = {
  label: "Voice Changer Pro", orderedVoices: [], model: "eleven_english_sts_v2",
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
      <VoiceRecastConfig
        data={{ ...baseData, orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "match" }] }}
        onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
      />,
    )
    expect(screen.queryByLabelText(/Volume \(/)).not.toBeInTheDocument()
    unmount()

    // Normalize: still no slider.
    const r2 = render(
      <VoiceRecastConfig
        data={{ ...baseData, orderedVoices: [{ voiceId: "v1", voiceLabel: "One", voiceType: "premade", volumeMode: "normalize" }] }}
        onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]}
      />,
    )
    expect(screen.queryByLabelText(/Volume \(/)).not.toBeInTheDocument()
    r2.unmount()

    // Manual: slider appears with default 100%.
    render(
      <VoiceRecastConfig
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
