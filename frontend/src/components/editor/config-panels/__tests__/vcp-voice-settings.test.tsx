import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { VcpVoiceSettings } from "../vcp-voice-settings"

// Select mock: flatten options under a native <select> so the v3 stability
// Select can be driven with fireEvent.change in jsdom (Radix's portal-based
// listbox cannot). Same mock as voice-changer-pro-config.test.tsx.
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

const base = { voiceId: "v1", voiceLabel: "One", voiceType: "premade" as const }
const renderIt = (v: Record<string, unknown>, updateVoice = vi.fn()) => {
  render(<VcpVoiceSettings index={0} voice={{ ...base, ...v }} updateVoice={updateVoice} />)
  return updateVoice
}

describe("VcpVoiceSettings — engines", () => {
  it("offers Recast, Re-speak (v3) and Re-speak (v4)", () => {
    renderIt({})
    for (const name of ["Recast", "Re-speak (v3)", "Re-speak (v4)"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(screen.getByRole("radio", { name: "Recast" })).toHaveAttribute("aria-checked", "true")
  })

  it("v3 shows the three-step Stability select and no other lever", () => {
    renderIt({ engine: "v3", stability: 0.5 })
    expect(screen.getByRole("radio", { name: "Re-speak (v3)" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("combobox", { name: "Stability" })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Similarity/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Style Exaggeration/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Speaker Boost/)).not.toBeInTheDocument()
  })

  it("v4 shows a continuous Stability slider and Similarity — no Style, no Speaker Boost", () => {
    renderIt({ engine: "v4", stability: 0.37 })
    expect(screen.getByRole("radio", { name: "Re-speak (v4)" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByLabelText(/Stability \(0.37\)/)).toHaveAttribute("type", "range")
    expect(screen.getByLabelText(/Similarity/)).toHaveAttribute("type", "range")
    expect(screen.queryByLabelText(/Style Exaggeration/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Speaker Boost/)).not.toBeInTheDocument()
  })

  it("Recast (the default) shows every speech-to-speech lever", () => {
    renderIt({})
    expect(screen.getByLabelText(/Stability \(0.5\)/)).toHaveAttribute("type", "range")
    expect(screen.getByLabelText(/Similarity \(0.75\)/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Style Exaggeration \(0\)/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Speaker Boost/)).toBeInTheDocument()
  })

  it("shows the Re-speak warning for v3 and v4, not for Recast", () => {
    const { unmount } = render(<VcpVoiceSettings index={0} voice={{ ...base, engine: "v4" }} updateVoice={vi.fn()} />)
    expect(screen.getByText(/Re-speak regenerates the performance/)).toBeInTheDocument()
    unmount()
    const r2 = render(<VcpVoiceSettings index={0} voice={{ ...base, engine: "v3" }} updateVoice={vi.fn()} />)
    expect(screen.getByText(/Re-speak regenerates the performance/)).toBeInTheDocument()
    r2.unmount()
    render(<VcpVoiceSettings index={0} voice={{ ...base }} updateVoice={vi.fn()} />)
    expect(screen.queryByText(/Re-speak regenerates the performance/)).not.toBeInTheDocument()
  })

  it("switching v4 → v3 snaps an off-grid stability (v3 takes 0 / 0.5 / 1) — from the click, never an effect", () => {
    const update = renderIt({ engine: "v4", stability: 0.37 })
    fireEvent.click(screen.getByRole("radio", { name: "Re-speak (v3)" }))
    expect(update).toHaveBeenCalledWith(0, { engine: "v3", stability: 0.5 })
  })

  it("switching to v3 keeps an on-grid stability as is", () => {
    const update = renderIt({ engine: "v4", stability: 1 })
    fireEvent.click(screen.getByRole("radio", { name: "Re-speak (v3)" }))
    expect(update).toHaveBeenCalledWith(0, { engine: "v3", stability: 1 })
  })

  it("switching v3 → v4 keeps the stability as is", () => {
    const update = renderIt({ engine: "v3", stability: 1 })
    fireEvent.click(screen.getByRole("radio", { name: "Re-speak (v4)" }))
    expect(update).toHaveBeenCalledWith(0, { engine: "v4" })
  })

  it("switching back to Recast clears the engine", () => {
    const update = renderIt({ engine: "v4", stability: 0.37 })
    fireEvent.click(screen.getByRole("radio", { name: "Recast" }))
    expect(update).toHaveBeenCalledWith(0, { engine: undefined })
  })

  it("the v4 Similarity slider writes similarityBoost for this voice's index", () => {
    const update = renderIt({ engine: "v4" })
    fireEvent.change(screen.getByLabelText(/Similarity/), { target: { value: "0.8" } })
    expect(update).toHaveBeenCalledWith(0, { similarityBoost: 0.8 })
  })

  it("the v3 Stability select writes the chosen step", () => {
    const update = renderIt({ engine: "v3", stability: 0.5 })
    fireEvent.change(screen.getByRole("combobox", { name: "Stability" }), { target: { value: "1" } })
    expect(update).toHaveBeenCalledWith(0, { stability: 1 })
  })

  it("rendering never writes (a node that is only selected is not rewritten)", () => {
    const update = renderIt({ engine: "v4", stability: 0.37, style: 0.4 })
    expect(update).not.toHaveBeenCalled()
  })
})
