import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { createRef } from "react"
import {
  SuggestionList,
  type SuggestionListHandle,
  type SuggestionCommandPayload,
} from "../prompt-editor/suggestion-list"
import type { RefImageItem } from "../tag-textarea"

/**
 * Tests for the Slice 4 location drill UI in `SuggestionList`.
 *
 * The list is a hybrid picker that drills into a hierarchical view for both
 * characters and locations. Slice 4 adds the location hierarchy (root →
 * variants → mode picker) — these tests cover the drill state machine, the
 * `command` payload shape, and the keyboard navigation between levels.
 *
 * The character drill was already there from slice 3a; we keep one
 * smoke-test for it so we know we didn't regress while threading the new
 * location state through the same component.
 */

// Minimal RefImageItem fixtures — only the fields used by SuggestionList's
// render path. `defaultLabel` and `index` are required by the type even
// when irrelevant to the test scenario.
function characterRef(opts: {
  characterSlug: string
  label: string
  variantSlug?: string
  variantDisplayName?: string
  index?: number
}): RefImageItem {
  return {
    url: "https://example.com/char.png",
    label: opts.label,
    source: "character",
    index: opts.index ?? 1,
    defaultLabel: "person",
    characterSlug: opts.characterSlug,
    variantSlug: opts.variantSlug,
    variantDisplayName: opts.variantDisplayName,
  }
}

function locationRef(opts: {
  locationSlug: string
  label: string
  bucket?: string
  variant?: string
  variantDisplayName?: string
  index?: number
}): RefImageItem {
  return {
    url: "https://example.com/loc.png",
    label: opts.label,
    source: "location",
    index: opts.index ?? 1,
    defaultLabel: "scene",
    locationSlug: opts.locationSlug,
    locationVariantBucket: opts.bucket,
    locationVariantSlug: opts.variant,
    locationVariantDisplayName: opts.variantDisplayName,
  }
}

const OLD_LIBRARY_REFS: RefImageItem[] = [
  locationRef({ locationSlug: "oldlibrary", label: "Old Library", index: 1 }),
  locationRef({
    locationSlug: "oldlibrary",
    label: "Old Library",
    bucket: "weather",
    variant: "rain",
    variantDisplayName: "rain",
    index: 2,
  }),
  locationRef({
    locationSlug: "oldlibrary",
    label: "Old Library",
    bucket: "lighting",
    variant: "neon",
    variantDisplayName: "neon",
    index: 3,
  }),
]

const KIRA_REFS: RefImageItem[] = [
  characterRef({ characterSlug: "kira", label: "Kira", index: 4 }),
  characterRef({
    characterSlug: "kira",
    label: "Kira",
    variantSlug: "smile",
    variantDisplayName: "smile",
    index: 5,
  }),
]

function renderList(items: RefImageItem[] = [...OLD_LIBRARY_REFS, ...KIRA_REFS]) {
  const command = vi.fn<(item: SuggestionCommandPayload) => void>()
  const onDrillChange = vi.fn<() => void>()
  const handle = createRef<SuggestionListHandle>()
  const utils = render(
    <SuggestionList
      ref={handle}
      items={items}
      query=""
      command={command}
      onDrillChange={onDrillChange}
    />,
  )
  return { ...utils, command, onDrillChange, handle }
}

function dispatchKey(handle: React.RefObject<SuggestionListHandle | null>, key: string) {
  // SuggestionList's onKeyDown takes the raw KeyboardEvent; we hand it a
  // synthetic one so we don't need a focused element to receive the bubble.
  // Wrap in act() so React commits the state update (drill-in / drill-out)
  // before the next assertion reads the DOM.
  let handled = false
  act(() => {
    handled = handle.current?.onKeyDown(new KeyboardEvent("keydown", { key })) ?? false
  })
  return handled
}

/** Find the location-root button (rendered with `data-row-kind="location-root"`). */
function getLocationRootButton(): HTMLButtonElement {
  const buttons = screen.getAllByRole("button")
  const match = buttons.find(b => b.getAttribute("data-row-kind") === "location-root")
  if (!match) {
    throw new Error("location-root button not found")
  }
  return match as HTMLButtonElement
}

/** Find the character-root button (rendered with `data-row-kind="character-root"`). */
function getCharacterRootButton(): HTMLButtonElement {
  const buttons = screen.getAllByRole("button")
  const match = buttons.find(b => b.getAttribute("data-row-kind") === "character-root")
  if (!match) {
    throw new Error("character-root button not found")
  }
  return match as HTMLButtonElement
}

describe("SuggestionList — root view", () => {
  it("renders a row per character + one row per location at root", () => {
    renderList()
    // Character root + location root rows are present.
    expect(screen.getByText("Kira", { exact: false })).toBeInTheDocument()
    // "Old Library" appears in the location-root row.
    expect(screen.getByText("Old Library", { exact: false })).toBeInTheDocument()
    // The location-root row shows the variant count (3 entries → "/ 3 variants").
    expect(screen.getByText(/3 variants/)).toBeInTheDocument()
  })

  it("clicking a location-root row drills into the variant list (level 2)", () => {
    const { command, onDrillChange } = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)
    // Drill should have fired but command should NOT (drilling != inserting).
    expect(command).not.toHaveBeenCalled()
    expect(onDrillChange).toHaveBeenCalled()
    // Level 2 view: back row + canonical row + 2 bucketed variants. We
    // count `data-row-kind="location-variant"` buttons rather than fishing
    // for text — bucket names like "weather" appear in multiple rows once
    // we render the variant list.
    expect(screen.getByText(/← back/)).toBeInTheDocument()
    const variantButtons = screen.getAllByRole("button").filter(
      b => b.getAttribute("data-row-kind") === "location-variant",
    )
    // 3 location-variant rows: canonical + weather/rain + lighting/neon.
    expect(variantButtons).toHaveLength(3)
    // Canonical row is identifiable by its text content (the only row with
    // "canonical" in its label).
    const canonical = variantButtons.find(b => /canonical/.test(b.textContent ?? ""))
    expect(canonical).toBeDefined()
    // Weather/rain and lighting/neon are bucketed variants.
    expect(variantButtons.some(b => /weather/.test(b.textContent ?? "") && /rain/.test(b.textContent ?? ""))).toBe(true)
    expect(variantButtons.some(b => /lighting/.test(b.textContent ?? "") && /neon/.test(b.textContent ?? ""))).toBe(true)
  })
})

describe("SuggestionList — location drill level 2 (variant list)", () => {
  it("renders canonical first, then bucketed variants in original order", () => {
    const { handle } = renderList()
    // Drill in via keyboard: arrow-down past the character root, then enter
    // on the location root. (Image-refs come first, then character roots,
    // then location roots — we just iterate down.)
    // Simpler: click the row directly.
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)

    const buttons = screen.getAllByRole("button")
    // First button is the back row, second the canonical row.
    expect(buttons[0]).toHaveTextContent(/← back/)
    expect(buttons[1]).toHaveTextContent(/canonical/)

    // Suppress unused-var lint for the ref handle.
    expect(handle.current).not.toBeNull()
  })

  it("selecting the canonical row fires command with the canonical item (no mode override)", () => {
    const { command } = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)

    const canonicalBtn = screen.getAllByRole("button").find(b =>
      b.getAttribute("data-row-kind") === "location-variant"
      && /canonical/.test(b.textContent ?? ""),
    )!
    expect(canonicalBtn).toBeDefined()
    fireEvent.mouseDown(canonicalBtn)

    expect(command).toHaveBeenCalledTimes(1)
    const payload = command.mock.calls[0][0]
    // Canonical: no bucket / no variant / no locationUsageMode override.
    expect(payload).toMatchObject({
      source: "location",
      locationSlug: "oldlibrary",
    })
    expect(payload.locationVariantBucket).toBeUndefined()
    expect(payload.locationVariantSlug).toBeUndefined()
    expect(payload.locationUsageMode).toBeUndefined()
  })

  it("selecting a bucketed variant row fires command with bucket+variant (no mode override)", () => {
    const { command } = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)

    const rainBtn = screen.getAllByRole("button").find(b =>
      b.getAttribute("data-row-kind") === "location-variant"
      && /weather/.test(b.textContent ?? "")
      && /rain/.test(b.textContent ?? ""),
    )!
    expect(rainBtn).toBeDefined()
    fireEvent.mouseDown(rainBtn)

    expect(command).toHaveBeenCalledTimes(1)
    const payload = command.mock.calls[0][0]
    expect(payload).toMatchObject({
      source: "location",
      locationSlug: "oldlibrary",
      locationVariantBucket: "weather",
      locationVariantSlug: "rain",
    })
    expect(payload.locationUsageMode).toBeUndefined()
  })

  it("Right-arrow on a location-variant row drills into the mode picker (level 3)", () => {
    const { handle } = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)
    // Default selection lands on the first data row (canonical at index 1
    // after the back row at index 0). Right-arrow drills into the mode picker.
    const handled = dispatchKey(handle, "ArrowRight")
    expect(handled).toBe(true)
    // Level 3 view: back row + 4 location modes.
    expect(screen.getByText("Match exactly")).toBeInTheDocument()
    expect(screen.getByText("Style / mood only")).toBeInTheDocument()
    expect(screen.getByText("Layout / framing only")).toBeInTheDocument()
    expect(screen.getByText("No textual bias")).toBeInTheDocument()
  })

  it("clicking the trailing mode chip on a location-variant row drills into the mode picker", () => {
    renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)

    const chip = screen.getAllByTestId("location-variant-mode-chip")[0]
    fireEvent.mouseDown(chip)

    // Level 3 view rendered.
    expect(screen.getByText("Match exactly")).toBeInTheDocument()
  })

  it("Backspace pops back to root when empty filter", () => {
    const { handle } = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)
    expect(screen.getByText(/← back/)).toBeInTheDocument()

    const handled = dispatchKey(handle, "Backspace")
    expect(handled).toBe(true)
    // Back at the root view — Old Library appears as the location-root row again.
    expect(screen.queryByText(/← back/)).not.toBeInTheDocument()
  })
})

describe("SuggestionList — location mode picker (level 3)", () => {
  function drillToModePicker() {
    const utils = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)
    // Default selection (canonical, index 1) → Right arrow drills into mode picker.
    dispatchKey(utils.handle, "ArrowRight")
    return utils
  }

  it("renders all 4 location modes with their human-readable labels", () => {
    drillToModePicker()
    expect(screen.getByText("Match exactly")).toBeInTheDocument()
    expect(screen.getByText("Style / mood only")).toBeInTheDocument()
    expect(screen.getByText("Layout / framing only")).toBeInTheDocument()
    expect(screen.getByText("No textual bias")).toBeInTheDocument()
  })

  it("clicking a mode row fires command with locationUsageMode set, preserving the source item attrs", () => {
    const { command } = drillToModePicker()
    const styleRow = screen.getByText("Style / mood only").closest("button")!
    fireEvent.mouseDown(styleRow)

    expect(command).toHaveBeenCalledTimes(1)
    const payload = command.mock.calls[0][0]
    // We drilled from the canonical row, so the payload retains the
    // canonical's locationSlug AND has the new `locationUsageMode: "style"`.
    expect(payload).toMatchObject({
      source: "location",
      locationSlug: "oldlibrary",
      locationUsageMode: "style",
    })
    expect(payload.locationVariantBucket).toBeUndefined()
    expect(payload.locationVariantSlug).toBeUndefined()
  })

  it("Left-arrow pops back from the mode picker to the variant list", () => {
    const { handle } = drillToModePicker()
    expect(screen.getByText("Match exactly")).toBeInTheDocument()

    const handled = dispatchKey(handle, "ArrowLeft")
    expect(handled).toBe(true)
    expect(screen.queryByText("Match exactly")).not.toBeInTheDocument()
    // Back at level 2 view.
    expect(screen.getByText(/canonical/)).toBeInTheDocument()
  })

  it("Backspace with empty filter pops back from mode picker to variant list", () => {
    const { handle } = drillToModePicker()
    const handled = dispatchKey(handle, "Backspace")
    expect(handled).toBe(true)
    expect(screen.queryByText("Match exactly")).not.toBeInTheDocument()
  })

  it("preserves the bucket/variant when drilling from a bucketed variant", () => {
    const { command } = renderList()
    const locRoot = getLocationRootButton()
    fireEvent.mouseDown(locRoot)

    // Click the mode chip on the rain row (bucketed variant).
    const rainBtn = screen.getAllByRole("button").find(b =>
      b.getAttribute("data-row-kind") === "location-variant"
      && /weather/.test(b.textContent ?? "")
      && /rain/.test(b.textContent ?? ""),
    )!
    const chip = rainBtn.querySelector("[data-testid='location-variant-mode-chip']")! as HTMLElement
    fireEvent.mouseDown(chip)

    // Now pick "Layout / framing only" — the payload must keep bucket+variant.
    const layoutRow = screen.getByText("Layout / framing only").closest("button")!
    fireEvent.mouseDown(layoutRow)

    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0][0]).toMatchObject({
      source: "location",
      locationSlug: "oldlibrary",
      locationVariantBucket: "weather",
      locationVariantSlug: "rain",
      locationUsageMode: "layout",
    })
  })
})

describe("SuggestionList — character drill (regression — slice 3a behavior)", () => {
  it("still drills into character variants from the root", () => {
    const { command } = renderList()
    const charRoot = getCharacterRootButton()
    fireEvent.mouseDown(charRoot)
    // Level 2: back row + 2 character variants (canonical + smile).
    expect(screen.getByText(/← back/)).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
  })

  it("character mode picker still fires command with usageMode (no regression)", () => {
    const { command, handle } = renderList()
    const charRoot = getCharacterRootButton()
    fireEvent.mouseDown(charRoot)
    dispatchKey(handle, "ArrowRight") // drill into character mode picker

    // Character mode labels include "Identical", "Face only", etc.
    const identicalRow = screen.getByText("Identical").closest("button")!
    fireEvent.mouseDown(identicalRow)

    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0][0]).toMatchObject({
      source: "character",
      characterSlug: "kira",
      usageMode: "identical",
    })
  })
})

describe("SuggestionList — flat search (any query)", () => {
  it("a non-empty query reveals location entries flat, with full paths", () => {
    const { command } = renderList()
    // Re-render with a query — easier than wiring up the typing path.
    render(
      <SuggestionList
        items={OLD_LIBRARY_REFS}
        query="rain"
        command={command}
        onDrillChange={() => {}}
      />,
    )

    // The rain variant from the weather bucket should appear (no drill required).
    const rainRow = screen.getAllByRole("button").find(b =>
      b.getAttribute("data-row-kind") === "location-variant"
      && /rain/.test(b.textContent ?? ""),
    )
    expect(rainRow).toBeDefined()
    // Full-path label: "Old Library / weather / rain"
    expect(rainRow!.textContent).toMatch(/Old Library/)
    expect(rainRow!.textContent).toMatch(/weather/)
    expect(rainRow!.textContent).toMatch(/rain/)
  })

  it("flat-search location row inserts directly without drilling (no mode override)", () => {
    const command = vi.fn<(item: SuggestionCommandPayload) => void>()
    render(
      <SuggestionList
        items={OLD_LIBRARY_REFS}
        query="rain"
        command={command}
        onDrillChange={() => {}}
      />,
    )
    const rainRow = screen.getAllByRole("button").find(b =>
      b.getAttribute("data-row-kind") === "location-variant"
      && /rain/.test(b.textContent ?? ""),
    )!
    fireEvent.mouseDown(rainRow)

    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0][0]).toMatchObject({
      source: "location",
      locationSlug: "oldlibrary",
      locationVariantBucket: "weather",
      locationVariantSlug: "rain",
    })
    expect(command.mock.calls[0][0].locationUsageMode).toBeUndefined()
  })
})
