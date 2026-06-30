import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { createElement } from "react"

/**
 * Wiring tests for the Phase D Task 3 HYBRID role menu on the cyan location
 * pill. The menu's visual rendering is a human staging check; this file pins
 * the load-bearing wiring — the role click → `roleToLocationRefSlots` →
 * `updateAttributes` path, the presets-only menu (NO Custom), and the
 * slug→phrase badge.
 *
 * Two narrow mocks:
 *   - `@tiptap/react` `NodeViewWrapper` → a plain span (same as the legacy
 *     view test) so we can drive the React component with hand-rolled props.
 *   - `@/lib/image-reference-format` → forces `"hybrid"` (the module resolves
 *     to legacy in the default test env), mounting the role menu. The legacy
 *     menu is covered byte-identically by `location-ref-view.test.tsx`.
 */
vi.mock("@tiptap/react", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  NodeViewWrapper: ({ as, children, ...rest }: any) => {
    const Tag = (as ?? "span") as string
    return createElement(Tag, rest, children)
  },
}))

vi.mock("@/lib/image-reference-format", () => ({ IMAGE_REFERENCE_FORMAT: "hybrid" }))

import { LocationRefView } from "../prompt-editor/location-ref-view"

type MockRefEntry = {
  url: string
  locationSlug?: string
  label?: string
}

function mockEditor(refs: ReadonlyArray<MockRefEntry>) {
  const ed = {
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
  role: string | null
}> = {}) {
  const updateAttributes = vi.fn()
  return {
    updateAttributes,
    editor: mockEditor([{
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
        role: attrs.role ?? null,
      },
      nodeSize: 1,
    },
    selected: false,
    getPos: () => 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function openMenu() {
  fireEvent.mouseDown(document.querySelector(".location-ref-pill__label")!)
}

describe("LocationRefView — hybrid role menu", () => {
  beforeEach(() => cleanup())

  it("opens the ROLE menu (not the usage-mode menu) with presets by phrase + Default", () => {
    render(<LocationRefView {...mockProps()} />)
    openMenu()
    expect(screen.getByTestId("location-ref-role-menu")).toBeInTheDocument()
    expect(screen.queryByTestId("location-ref-mode-menu")).toBeNull()
    expect(screen.getByText("Default (from location)")).toBeInTheDocument()
    expect(screen.getByText("background")).toBeInTheDocument()
    // Multi-word preset shown in phrase form (slug stored on pick).
    expect(screen.getByText("empty background")).toBeInTheDocument()
  })

  it("has NO Custom input (location parser is preset-gated)", () => {
    render(<LocationRefView {...mockProps()} />)
    openMenu()
    expect(screen.queryByText("Custom…")).toBeNull()
    expect(screen.queryByTestId("location-ref-role-custom-input")).toBeNull()
  })

  it("clicking a genuine role (background) sets role slot, clears the rest", () => {
    const props = mockProps()
    render(<LocationRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("background").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledTimes(1)
    expect(props.updateAttributes).toHaveBeenCalledWith({
      role: "background",
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("clicking a multi-word role (empty background) stores the slug 'empty-background'", () => {
    const props = mockProps()
    render(<LocationRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("empty background").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledWith({
      role: "empty-background",
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("clicking a usageMode-overlapping role (layout) routes to the usageMode slot (parser-stable)", () => {
    const props = mockProps()
    render(<LocationRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("layout").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledWith({
      role: null,
      usageMode: "layout",
      bucket: null,
      variant: null,
    })
  })

  it("Default clears ALL slots → canonical pill", () => {
    const props = mockProps({ role: "background" })
    render(<LocationRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("Default (from location)").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledWith({
      role: null,
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("shows the role phrase as the pill badge (slug → phrase)", () => {
    render(<LocationRefView {...mockProps({ role: "empty-background" })} />)
    const badge = document.querySelector(".location-ref-pill__mode-badge")
    expect(badge?.textContent).toBe("empty background")
  })

  it("surfaces a usageMode-overlapping role (layout, stored as usageMode) as the role badge + highlight", () => {
    render(<LocationRefView {...mockProps({ usageMode: "layout" })} />)
    expect(document.querySelector(".location-ref-pill__mode-badge")?.textContent).toBe("layout")
    openMenu()
    const menu = screen.getByTestId("location-ref-role-menu")
    const row = menu.querySelector("[data-role='layout']") as HTMLButtonElement
    expect(row.className).toMatch(/bg-cyan-500\/15/)
    expect(row.textContent).toMatch(/✓/)
  })

  it("the active role row is cyan-highlighted with a check mark", () => {
    render(<LocationRefView {...mockProps({ role: "background" })} />)
    openMenu()
    const menu = screen.getByTestId("location-ref-role-menu")
    const row = menu.querySelector("[data-role='background']") as HTMLButtonElement
    expect(row.className).toMatch(/bg-cyan-500\/15/)
    expect(row.className).toMatch(/text-cyan-700|text-cyan-300/)
    expect(row.textContent).toMatch(/✓/)
  })

  it("a non-role usageMode (none) shows no role badge and highlights Default", () => {
    render(<LocationRefView {...mockProps({ usageMode: "none" })} />)
    // "none" is a LocationUsageMode but NOT a role preset → no role badge.
    expect(document.querySelector(".location-ref-pill__mode-badge")).toBeNull()
    openMenu()
    const defaultRow = screen.getByText("Default (from location)").closest("button")!
    expect(defaultRow.textContent).toMatch(/✓/)
  })
})
