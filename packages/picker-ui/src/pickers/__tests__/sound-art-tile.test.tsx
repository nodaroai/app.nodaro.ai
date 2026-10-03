import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SoundArtTile, type SoundArtTileProps } from "../sound-art-tile"
import { MusicGenrePicker } from "../music-genre-picker"
import { MusicMoodPicker } from "../music-mood-picker"
import { InstrumentationPicker } from "../instrumentation-picker"
import { VoiceCharacterPicker } from "../voice-character-picker"
import { VoiceDeliveryPicker } from "../voice-delivery-picker"
import { SOUND_ART_FILES } from "@nodaro/prompts"

const EMOJI = { url: "/picker-art/emoji/guitar_3d.0000abcd.webp", kind: "emoji" } as const
const FLAG = { url: "/picker-art/flags/gb.0000abcd.webp", kind: "flag" } as const

function tile(overrides: Partial<SoundArtTileProps> = {}) {
  const props: SoundArtTileProps = {
    label: "Female",
    description: "Female voice",
    art: EMOJI,
    selected: false,
    checked: true,
    sectionLabel: "Gender",
    multi: false,
    onPick: () => {},
    ...overrides,
  }
  return render(<SoundArtTile {...props} />)
}

describe("SoundArtTile", () => {
  it("renders the picture as a decorative, lazy image", () => {
    const { container } = tile()
    const img = container.querySelector("img")!
    expect(img.getAttribute("src")).toBe(EMOJI.url)
    expect(img.getAttribute("alt")).toBe("")
    expect(img.getAttribute("loading")).toBe("lazy")
  })

  it("frames a flag and renders it too", () => {
    const { container } = tile({ art: FLAG })
    expect(container.querySelector("img")!.getAttribute("src")).toBe(FLAG.url)
  })

  it("keeps the label as the accessible name even with a description", () => {
    tile()
    expect(screen.getByRole("radio", { name: "Female" })).toBeInTheDocument()
  })

  it("shows a description that adds something, hidden from the accessible name", () => {
    const { container } = tile()
    const desc = [...container.querySelectorAll("span[aria-hidden='true']")].find((s) => s.textContent === "Female voice")
    expect(desc).toBeDefined()
  })

  it("drops a description that only repeats the label", () => {
    const { container } = tile({ label: "Trap", description: "trap" })
    expect(container.textContent).toBe("Trap")
  })

  it("falls back to the label alone when the picture fails to load", () => {
    const { container } = tile()
    fireEvent.error(container.querySelector("img")!)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByRole("radio", { name: "Female" })).toBeInTheDocument()
  })

  it("renders the label alone when the option has no picture", () => {
    const { container } = tile({ art: undefined })
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("Female")).toBeInTheDocument()
  })

  it("marks a single pick with a check and keeps radio semantics", () => {
    const onPick = vi.fn()
    const { container } = tile({ selected: true, onPick })
    const button = screen.getByRole("radio", { name: "Female" })
    expect(button.getAttribute("aria-checked")).toBe("true")
    expect(container.querySelector(".lucide-check")).not.toBeNull()
    fireEvent.click(button)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it("shows the multi-pick badge instead of the check, as a sibling of the button", () => {
    const { container } = tile({ selected: true, multi: true, badge: <button type="button">badge</button> })
    expect(screen.getByRole("checkbox", { name: "Female" })).toBeInTheDocument()
    expect(container.querySelector(".lucide-check")).toBeNull()
    const badge = screen.getByRole("button", { name: "badge" })
    expect(screen.getByRole("checkbox", { name: "Female" }).contains(badge)).toBe(false)
  })
})

/** Every visible option tile of a picker shows a picture that exists in the generated file map. */
function expectEveryTileHasArt(container: HTMLElement) {
  const tiles = [...container.querySelectorAll("button[role='radio'], button[role='checkbox']")]
  expect(tiles.length).toBeGreaterThan(0)
  const known = new Set(Object.values(SOUND_ART_FILES as Readonly<Record<string, string>>).map((f) => `/picker-art/${f}`))
  const bad = tiles
    .filter((t) => {
      const src = t.querySelector("img")?.getAttribute("src")
      return !src || !known.has(src)
    })
    .map((t) => t.getAttribute("aria-label"))
  expect(bad).toEqual([])
}

describe("music / voice pickers — every tile carries its picture", () => {
  const noop = () => {}
  it("Music Genre (with a genre picked, so subgenres show)", () => {
    const { container } = render(<MusicGenrePicker value={{ genre: "pop", era: "modern" }} onChange={noop} />)
    expectEveryTileHasArt(container)
  })
  it("Music Mood", () => {
    const { container } = render(<MusicMoodPicker value={{}} onChange={noop} />)
    expectEveryTileHasArt(container)
  })
  it("Instrumentation", () => {
    const { container } = render(<InstrumentationPicker value={{}} onChange={noop} />)
    expectEveryTileHasArt(container)
  })
  it("Voice Character", () => {
    const { container } = render(<VoiceCharacterPicker value={{}} onChange={noop} />)
    expectEveryTileHasArt(container)
  })
  it("Voice Delivery", () => {
    const { container } = render(<VoiceDeliveryPicker value={{}} onChange={noop} />)
    expectEveryTileHasArt(container)
  })

  it("keeps the DOM the config panel's keyboard nav relies on", () => {
    // config-keyboard-nav.ts / config-panel.tsx select native button tiles with
    // role radio|checkbox + aria-checked inside a group|radiogroup grid; a
    // disabled / aria-disabled tile is skipped by focus, a tabIndex fights the
    // roving tab stop, and a role nested inside a tile confuses the grid scan.
    const pickers = [
      <MusicGenrePicker key="g" value={{ genre: "pop" }} onChange={noop} />,
      <MusicMoodPicker key="m" value={{ emotion: ["happy"] }} onChange={noop} />,
      <InstrumentationPicker key="i" value={{ instruments: ["piano"] }} onChange={noop} />,
      <VoiceCharacterPicker key="c" value={{ language: "english" }} onChange={noop} />,
      <VoiceDeliveryPicker key="d" value={{ pace: "slow" }} onChange={noop} />,
    ]
    for (const picker of pickers) {
      const { container, unmount } = render(picker)
      const tiles = [...container.querySelectorAll("[role='radio'], [role='checkbox']")]
      expect(tiles.length).toBeGreaterThan(0)
      for (const t of tiles) {
        expect(t.tagName).toBe("BUTTON")
        expect(t.hasAttribute("aria-checked")).toBe(true)
        expect(t.hasAttribute("disabled")).toBe(false)
        expect(t.hasAttribute("aria-disabled")).toBe(false)
        expect(t.hasAttribute("tabindex")).toBe(false)
        expect(t.querySelector("[role], button, a, input")).toBeNull()
        expect(t.closest("[role='radiogroup'], [role='group']")).not.toBeNull()
      }
      unmount()
    }
  })

  it("Music Genre explains an empty Subgenre section instead of hiding it", () => {
    const { rerender } = render(<MusicGenrePicker value={{}} onChange={noop} />)
    expect(screen.getByText("Pick a genre above to see its subgenres")).toBeInTheDocument()
    rerender(<MusicGenrePicker value={{ genre: ["pop", "rock"] }} onChange={noop} />)
    expect(screen.getByText("Subgenres work with a single genre")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Enable Subgenre" })).toBeDisabled()
  })
})
