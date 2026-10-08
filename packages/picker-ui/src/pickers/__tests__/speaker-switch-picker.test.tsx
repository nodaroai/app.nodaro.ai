import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { SpeakerSwitchPicker, SPEAKER_CROSSFADE_COMBINE_IDS } from "../speaker-switch-picker"
import { SPEAKER_SWITCHES } from "@nodaro/shared"

const BASIC = [
  { id: "cut", label: "Cut" },
  { id: "pan", label: "Pan" },
  { id: "zoom", label: "Zoom" },
]

const picker = (over: Partial<Parameters<typeof SpeakerSwitchPicker>[0]> = {}) => (
  <SpeakerSwitchPicker
    options={BASIC}
    value="cut"
    onChange={() => {}}
    ariaLabel="Switch"
    crossfadeLabel="Crossfade…"
    {...over}
  />
)

describe("SpeakerSwitchPicker", () => {
  it("draws Cut, Pan, Zoom and a Crossfade tile in one radiogroup", () => {
    render(picker())
    const group = screen.getByRole("radiogroup", { name: "Switch" })
    const names = within(group).getAllByRole("radio").map((r) => r.textContent?.trim())
    expect(names).toEqual(["Cut", "Pan", "Zoom", "Crossfade…"])
    expect(screen.getByRole("radio", { name: /^Cut/ })).toHaveAttribute("aria-checked", "true")
  })

  it("picking Pan or Zoom reports the id", () => {
    const onChange = vi.fn()
    render(picker({ onChange }))
    fireEvent.click(screen.getByRole("radio", { name: /Pan/ }))
    expect(onChange).toHaveBeenLastCalledWith("pan")
    fireEvent.click(screen.getByRole("radio", { name: /Zoom/ }))
    expect(onChange).toHaveBeenLastCalledWith("zoom")
  })

  it("a ruled-out switch says why and cannot be picked", () => {
    const onChange = vi.fn()
    render(picker({ onChange, options: [BASIC[0]!, { id: "pan", label: "Pan", disabled: true, reason: "None of the 63 speaker changes stays on one camera." }, BASIC[2]!] }))
    const pan = screen.getByRole("radio", { name: /Pan/ })
    expect(pan).toHaveAttribute("aria-disabled", "true")
    expect(pan).toHaveAttribute("title", "None of the 63 speaker changes stays on one camera.")
    fireEvent.click(pan)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("the Crossfade tile opens a popover offering only the xfade family", () => {
    const onChange = vi.fn()
    render(picker({ onChange }))
    fireEvent.click(screen.getByRole("radio", { name: /Crossfade/ }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("radio", { name: /Fade$/ })).toBeTruthy()
    // the catalog's own tiles (".ct-tile") are crossfades only: its "Cut" is not among them
    const catalog = [...dialog.querySelectorAll(".ct-tile .ct-tile-label")].map((l) => l.textContent)
    expect(catalog.length).toBeGreaterThan(0)
    expect(catalog).not.toContain("Cut")
  })

  it("picking a crossfade writes xfade:<combine id>", () => {
    const onChange = vi.fn()
    render(picker({ onChange }))
    fireEvent.click(screen.getByRole("radio", { name: /Crossfade/ }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Dissolve/ }))
    expect(onChange).toHaveBeenCalledWith("xfade:dissolve")
  })

  it("a chosen crossfade is the checked tile and names itself", () => {
    render(picker({ value: "xfade:wipe-left", crossfadeSelectedLabel: "Crossfade: Wipe Left" }))
    expect(screen.getByRole("radio", { name: /Crossfade: Wipe Left/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /^Cut/ })).toHaveAttribute("aria-checked", "false")
  })

  it("the popover lists the basic switches too, so one visit changes anything", () => {
    const onChange = vi.fn()
    render(picker({ onChange, value: "xfade:fade" }))
    fireEvent.click(screen.getByRole("radio", { name: /Crossfade/ }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Zoom/ }))
    expect(onChange).toHaveBeenCalledWith("zoom")
  })

  describe("a Crossfade ruled out (no speaker change crosses a clock jump)", () => {
    const REASON = "Nothing was cut out between the speakers."
    const ruled = (over: Partial<Parameters<typeof SpeakerSwitchPicker>[0]> = {}) => picker({ crossfadeDisabled: true, crossfadeReason: REASON, ...over })

    it("greys the tile with its reason on hover, and reads it aloud", () => {
      render(ruled())
      const tile = screen.getByRole("radio", { name: /Crossfade/ })
      expect(tile).toHaveAttribute("aria-disabled", "true")
      expect(tile).toHaveAttribute("title", REASON)
      expect(tile).toHaveAttribute("aria-describedby")
      expect(document.getElementById(tile.getAttribute("aria-describedby")!)?.textContent).toBe(REASON)
    })

    it("shows the reason visibly while the tile holds keyboard focus", () => {
      render(ruled())
      expect(screen.queryByTestId("stv-reason-caption")).toBeNull()
      fireEvent.focus(screen.getByRole("radio", { name: /Crossfade/ }))
      expect(screen.getByTestId("stv-reason-caption").textContent).toBe(REASON)
    })

    it("does not open the transition popover, and never reports a value", () => {
      const onChange = vi.fn()
      render(ruled({ onChange }))
      fireEvent.click(screen.getByRole("radio", { name: /Crossfade/ }))
      fireEvent.keyDown(screen.getByRole("radio", { name: /Crossfade/ }), { key: "Enter" })
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByRole("radio", { name: /Crossfade/ })).not.toHaveAttribute("aria-haspopup")
    })

    it("a stored crossfade stays the checked tile, greyed (the value is left as set)", () => {
      render(ruled({ value: "xfade:wipe-left", crossfadeSelectedLabel: "Crossfade: Wipe Left" }))
      const tile = screen.getByRole("radio", { name: /Crossfade: Wipe Left/ })
      expect(tile).toHaveAttribute("aria-checked", "true")
      expect(tile).toHaveAttribute("aria-disabled", "true")
    })

    it("leaves the other tiles pickable", () => {
      const onChange = vi.fn()
      render(ruled({ onChange }))
      fireEvent.click(screen.getByRole("radio", { name: /Zoom/ }))
      expect(onChange).toHaveBeenCalledWith("zoom")
    })

    it("an available Crossfade is unchanged: not greyed, no reason, still opens", () => {
      render(picker({ crossfadeDisabled: false }))
      const tile = screen.getByRole("radio", { name: /Crossfade/ })
      expect(tile).not.toHaveAttribute("aria-disabled")
      expect(tile).not.toHaveAttribute("title")
      fireEvent.click(tile)
      expect(screen.getByRole("dialog")).toBeTruthy()
    })
  })

  it("the xfade ids are derived from the registry, never hand-listed", () => {
    const fromRegistry = SPEAKER_SWITCHES.filter((s) => s.overlaps).map((s) => s.id.slice("xfade:".length))
    expect([...SPEAKER_CROSSFADE_COMBINE_IDS]).toEqual(fromRegistry)
    expect(fromRegistry).not.toContain("cut")
    expect(fromRegistry.length).toBeGreaterThan(20)
  })

  it("draws no English of its own: every string comes from the host's props or its localizer", () => {
    render(picker({ localizeLabel: (english) => `§${english}`, options: [{ id: "cut", label: "§cut" }, { id: "pan", label: "§pan" }, { id: "zoom", label: "§zoom" }], crossfadeLabel: "§xf", ariaLabel: "§switch" }))
    fireEvent.click(screen.getByRole("radio", { name: /§xf/ }))
    const dialog = screen.getByRole("dialog")
    const texts: string[] = []
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) texts.push(n.textContent.trim())
    expect(texts.length).toBeGreaterThan(10)
    expect(texts.filter((x) => !x.startsWith("§"))).toEqual([])
    expect(dialog.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("§switch")
    expect(dialog.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("§Transition category")
  })
})
