import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { createElement } from "react"

/**
 * Tests for the Slice 4 mode-picker popover on the cyan location pill.
 *
 * The pill component (`LocationRefView`) is a TipTap React node view, which
 * makes it awkward to drive end-to-end through TipTap in jsdom. We mock
 * `@tiptap/react`'s `NodeViewWrapper` to a plain `<span>` so we can exercise
 * the React component directly with hand-rolled `NodeViewProps`.
 *
 * The mock is intentionally narrow — we only stub `NodeViewWrapper` (the
 * presentational shell). All real logic — the menu state, the
 * `updateAttributes` calls, the active-mode check mark, the CSS classes —
 * runs through the real component code.
 */
vi.mock("@tiptap/react", () => ({
  // The real `NodeViewWrapper` wraps the node-view body in the right
  // host element (span for inline atoms like our pill). We just need a
  // pass-through that respects the `as` prop so attribute assertions still
  // work — replacing it with a plain span via `createElement` is good
  // enough for unit tests and dodges JSX namespace typing issues.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  NodeViewWrapper: ({ as, children, ...rest }: any) => {
    const Tag = (as ?? "span") as string
    return createElement(Tag, rest, children)
  },
}))

// eslint-disable-next-line import/first
import { LocationRefView } from "../prompt-editor/location-ref-view"

interface MockNode {
  attrs: Record<string, unknown>
  nodeSize: number
}

type MockRefEntry = {
  url: string
  locationSlug?: string
  locationVariantBucket?: string
  locationVariantSlug?: string
  locationVariantDisplayName?: string
  label?: string
}

interface MockEditor {
  storage: {
    locationRef?: {
      referenceImages?: ReadonlyArray<MockRefEntry>
      revision?: number
    }
  }
  chain: () => MockEditor
  focus: () => MockEditor
  deleteRange: () => MockEditor
  run: () => boolean
}

function mockEditor(refs: ReadonlyArray<MockRefEntry> = []): MockEditor {
  const ed: MockEditor = {
    storage: { locationRef: { referenceImages: refs, revision: 1 } },
    chain: () => ed,
    focus: () => ed,
    deleteRange: () => ed,
    run: () => true,
  }
  return ed
}

function mockProps(attrs: Partial<{
  locationSlug: string
  imageIndex: number
  bucket: string | null
  variant: string | null
  usageMode: "identical" | "style" | "layout" | "none" | null
}> = {}, refs?: Parameters<typeof mockEditor>[0]) {
  const updateAttributes = vi.fn()
  return {
    updateAttributes,
    editor: mockEditor(refs ?? [{
      url: "https://example.com/loc.png",
      locationSlug: attrs.locationSlug ?? "oldlibrary",
      label: "Old Library",
    }]),
    node: {
      attrs: {
        locationSlug: attrs.locationSlug ?? "oldlibrary",
        imageIndex: attrs.imageIndex ?? 1,
        bucket: attrs.bucket ?? null,
        variant: attrs.variant ?? null,
        usageMode: attrs.usageMode ?? null,
      },
      nodeSize: 1,
    } as MockNode,
    selected: false,
    getPos: () => 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("LocationRefView — mode menu", () => {
  beforeEach(() => {
    // Testing Library's cleanup() unmounts every mounted component and
    // removes its portal mount, so the next test starts with a fresh DOM.
    cleanup()
  })

  it("renders the cyan pill with the slug and imageIndex", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1 })
    render(<LocationRefView {...props} />)
    // Pill label shows @<displayName>:N — the resolver maps the slug to
    // the "Old Library" label via the editor's storage mirror.
    expect(screen.getByText(/@Old Library/)).toBeInTheDocument()
    expect(screen.getByText(":1")).toBeInTheDocument()
  })

  it("clicking the label button opens the mode menu portal with all 4 modes + Default", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1 })
    render(<LocationRefView {...props} />)

    const label = document.querySelector(".location-ref-pill__label") as HTMLButtonElement
    expect(label).not.toBeNull()
    fireEvent.mouseDown(label)

    const menu = screen.getByTestId("location-ref-mode-menu")
    expect(menu).toBeInTheDocument()

    // "Default (from location)" row + 4 location mode rows.
    expect(screen.getByText("Default (from location)")).toBeInTheDocument()
    expect(screen.getByText("Match exactly")).toBeInTheDocument()
    expect(screen.getByText("Style / mood only")).toBeInTheDocument()
    expect(screen.getByText("Layout / framing only")).toBeInTheDocument()
    expect(screen.getByText("No textual bias")).toBeInTheDocument()
  })

  it("clicking a mode row calls updateAttributes with the picked mode", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1 })
    render(<LocationRefView {...props} />)

    const label = document.querySelector(".location-ref-pill__label") as HTMLButtonElement
    fireEvent.mouseDown(label)

    const styleRow = screen.getByText("Style / mood only").closest("button")!
    fireEvent.click(styleRow)

    expect(props.updateAttributes).toHaveBeenCalledTimes(1)
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: "style" })
  })

  it("clicking the Default row passes null to updateAttributes (clears override)", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1, usageMode: "style" })
    render(<LocationRefView {...props} />)

    const label = document.querySelector(".location-ref-pill__label") as HTMLButtonElement
    fireEvent.mouseDown(label)

    const defaultRow = screen.getByText("Default (from location)").closest("button")!
    fireEvent.click(defaultRow)

    expect(props.updateAttributes).toHaveBeenCalledTimes(1)
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: null })
  })

  it("the active mode shows a check mark in the Default row when usageMode is null", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1, usageMode: null })
    render(<LocationRefView {...props} />)
    fireEvent.mouseDown(document.querySelector(".location-ref-pill__label")!)
    const defaultRow = screen.getByText("Default (from location)").closest("button")!
    // The check mark sibling lives inside the same row when active.
    expect(defaultRow.textContent).toMatch(/✓/)
  })

  it("the active mode row uses the cyan-tinted background", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1, usageMode: "layout" })
    render(<LocationRefView {...props} />)
    fireEvent.mouseDown(document.querySelector(".location-ref-pill__label")!)
    // Two elements show "Layout / framing only": the pill mode badge (when
    // usageMode is set) AND the menu's layout row. Disambiguate by
    // querying for the row inside the menu container.
    const menu = screen.getByTestId("location-ref-mode-menu")
    const layoutRow = menu.querySelector("[data-mode='layout']") as HTMLButtonElement
    expect(layoutRow).not.toBeNull()
    // Mirror the violet character-side check — cyan-500/15 + cyan-700/300.
    expect(layoutRow.className).toMatch(/bg-cyan-500\/15/)
    expect(layoutRow.className).toMatch(/text-cyan-700|text-cyan-300/)
  })

  it("renders a mode-badge on the pill when usageMode is non-null", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1, usageMode: "layout" })
    render(<LocationRefView {...props} />)
    // Badge text is the human-readable label, not the raw mode key.
    const badge = document.querySelector(".location-ref-pill__mode-badge")
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe("Layout / framing only")
  })

  it("does NOT render a mode-badge when usageMode is null (default mode)", () => {
    const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1, usageMode: null })
    render(<LocationRefView {...props} />)
    expect(document.querySelector(".location-ref-pill__mode-badge")).toBeNull()
  })

  it("renders a broken state when the locationSlug isn't in the editor's storage", () => {
    const props = mockProps(
      { locationSlug: "unknown", imageIndex: 1 },
      [{ url: "https://example.com/loc.png", locationSlug: "oldlibrary", label: "Old Library" }],
    )
    render(<LocationRefView {...props} />)
    // No matching ref → broken-pill modifier on the wrapper + ? placeholder.
    expect(document.querySelector(".location-ref-pill--broken")).not.toBeNull()
    expect(screen.getByText("?")).toBeInTheDocument()
  })

  it("each of the 4 location modes can be picked and propagated through updateAttributes", () => {
    const expectedModes: Array<"identical" | "style" | "layout" | "none"> = [
      "identical",
      "style",
      "layout",
      "none",
    ]
    for (const mode of expectedModes) {
      cleanup()
      const props = mockProps({ locationSlug: "oldlibrary", imageIndex: 1 })
      render(<LocationRefView {...props} />)
      fireEvent.mouseDown(document.querySelector(".location-ref-pill__label")!)
      const row = document.querySelector(`[data-mode='${mode}']`) as HTMLButtonElement
      expect(row).not.toBeNull()
      fireEvent.click(row)
      expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: mode })
    }
  })
})
