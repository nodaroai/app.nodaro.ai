import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { createElement } from "react"

/**
 * Render tests for the hybrid role-label picker on the violet character pill
 * (Phase D Task 2), plus a legacy-byte-identical guard.
 *
 * Like `location-ref-view.test.tsx`, the pill is a TipTap React node view that
 * is awkward to drive end-to-end through TipTap in jsdom, so we stub
 * `NodeViewWrapper` to a plain element and exercise the real component with
 * hand-rolled `NodeViewProps`. The reference-format constant is mocked via a
 * hoisted holder so a single file can drive BOTH formats (the component reads
 * it at render time).
 */
const fmt = vi.hoisted(() => ({ value: "legacy" as "legacy" | "hybrid" }))

vi.mock("@/lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return fmt.value
  },
}))

vi.mock("@tiptap/react", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  NodeViewWrapper: ({ as, children, ...rest }: any) => {
    const Tag = (as ?? "span") as string
    return createElement(Tag, rest, children)
  },
}))

// eslint-disable-next-line import/first
import { CharacterRefView } from "../prompt-editor/character-ref-view"

interface MockNode {
  attrs: Record<string, unknown>
  nodeSize: number
}

type MockRefEntry = {
  url: string
  characterSlug?: string
  variantSlug?: string
  variantDisplayName?: string
  label?: string
}

function mockEditor(refs: ReadonlyArray<MockRefEntry>) {
  const ed = {
    storage: { characterRef: { referenceImages: refs, revision: 1 } },
    chain: () => ed,
    focus: () => ed,
    deleteRange: () => ed,
    run: () => true,
  }
  return ed
}

function mockProps(
  attrs: Partial<{
    characterSlug: string
    imageIndex: number
    variantSlug: string | null
    usageMode: string | null
  }> = {},
  refs?: ReadonlyArray<MockRefEntry>,
) {
  const updateAttributes = vi.fn()
  return {
    updateAttributes,
    editor: mockEditor(
      refs ?? [{ url: "https://example.com/kira.png", characterSlug: attrs.characterSlug ?? "kira", label: "Kira" }],
    ),
    node: {
      attrs: {
        characterSlug: attrs.characterSlug ?? "kira",
        imageIndex: attrs.imageIndex ?? 1,
        variantSlug: attrs.variantSlug ?? null,
        usageMode: attrs.usageMode ?? null,
      },
      nodeSize: 1,
    } as MockNode,
    selected: false,
    getPos: () => 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function openMenu() {
  const label = document.querySelector(".character-ref-pill__label") as HTMLButtonElement
  expect(label).not.toBeNull()
  fireEvent.mouseDown(label)
}

describe("CharacterRefView — HYBRID role menu", () => {
  beforeEach(() => {
    fmt.value = "hybrid"
    cleanup()
  })

  it("the swap-menu shows the curated ROLE presets + Custom + Default (not usage modes)", () => {
    render(<CharacterRefView {...mockProps()} />)
    openMenu()

    const menu = screen.getByTestId("character-ref-role-menu")
    expect(menu).toBeInTheDocument()
    expect(screen.getByText("Default (from character)")).toBeInTheDocument()
    // Every wired-character role preset renders…
    for (const role of ["person", "face", "clothes", "hair", "pose", "expression", "style"]) {
      expect(menu.querySelector(`[data-role='${role}']`)).not.toBeNull()
    }
    expect(screen.getByText("Custom…")).toBeInTheDocument()
    // …and the usage-mode-only labels do NOT (this is the role menu, not legacy).
    expect(screen.queryByText("Identical")).toBeNull()
    expect(screen.queryByText("Face only")).toBeNull()
  })

  it("(a) picking a UsageMode role (face) sets usageMode and CLEARS variantSlug", () => {
    const props = mockProps()
    render(<CharacterRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByTestId("character-ref-role-menu").querySelector("[data-role='face']")!)
    expect(props.updateAttributes).toHaveBeenCalledTimes(1)
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: "face", variantSlug: null })
  })

  it("(b) picking a role-only preset (clothes) sets variantSlug and CLEARS usageMode", () => {
    const props = mockProps({ usageMode: "face" })
    render(<CharacterRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByTestId("character-ref-role-menu").querySelector("[data-role='clothes']")!)
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: null, variantSlug: "clothes" })
  })

  it("the Default row clears BOTH slots", () => {
    const props = mockProps({ variantSlug: "clothes" })
    render(<CharacterRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("Default (from character)").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: null, variantSlug: null })
  })

  it("(c) a Custom role is sanitized into variantSlug", () => {
    const props = mockProps()
    render(<CharacterRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("Custom…"))
    const input = screen.getByTestId("character-ref-role-custom-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Earrings" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: null, variantSlug: "earrings" })
  })

  it("every role preset can be picked and lands in exactly one slot", () => {
    const usageModeRoles = new Set(["face", "pose", "style"])
    for (const role of ["person", "face", "clothes", "hair", "pose", "expression", "style"]) {
      cleanup()
      const props = mockProps()
      render(<CharacterRefView {...props} />)
      openMenu()
      fireEvent.click(screen.getByTestId("character-ref-role-menu").querySelector(`[data-role='${role}']`)!)
      const expected = usageModeRoles.has(role)
        ? { usageMode: role, variantSlug: null }
        : { usageMode: null, variantSlug: role }
      expect(props.updateAttributes).toHaveBeenCalledWith(expected)
    }
  })

  it("shows the active role on the pill badge (UsageMode slot)", () => {
    render(<CharacterRefView {...mockProps({ usageMode: "face" })} />)
    const badge = document.querySelector(".character-ref-pill__mode-badge")
    expect(badge?.textContent).toBe("face")
  })

  it("shows the active role on the pill badge (variantSlug slot) and suppresses the /variant segment", () => {
    render(<CharacterRefView {...mockProps({ variantSlug: "clothes", usageMode: null })} />)
    expect(document.querySelector(".character-ref-pill__mode-badge")?.textContent).toBe("clothes")
    // In hybrid the variant slot holds a role — no duplicate "/clothes" segment.
    expect(document.querySelector(".character-ref-pill__variant")).toBeNull()
  })
})

describe("CharacterRefView — LEGACY menu unchanged", () => {
  beforeEach(() => {
    fmt.value = "legacy"
    cleanup()
  })

  it("the swap-menu shows the usage modes + Default (no roles, no Custom)", () => {
    render(<CharacterRefView {...mockProps()} />)
    openMenu()
    expect(screen.getByText("Default (from character)")).toBeInTheDocument()
    expect(screen.getByText("Identical")).toBeInTheDocument()
    expect(screen.getByText("Face only")).toBeInTheDocument()
    // No hybrid affordances.
    expect(screen.queryByText("Custom…")).toBeNull()
    expect(screen.queryByTestId("character-ref-role-menu")).toBeNull()
    // Role-only labels never appear in the legacy menu.
    expect(screen.queryByText("clothes")).toBeNull()
    expect(screen.queryByText("hair")).toBeNull()
  })

  it("picking a usage mode calls updateAttributes with ONLY usageMode (byte-identical legacy)", () => {
    const props = mockProps()
    render(<CharacterRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("Face only").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledTimes(1)
    // Legacy never clears variantSlug — single-key update, exactly as before.
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: "face" })
  })

  it("the Default row passes usageMode:null (legacy clear)", () => {
    const props = mockProps({ usageMode: "face" })
    render(<CharacterRefView {...props} />)
    openMenu()
    fireEvent.click(screen.getByText("Default (from character)").closest("button")!)
    expect(props.updateAttributes).toHaveBeenCalledWith({ usageMode: null })
  })

  it("the pill badge shows the human usage-mode label (not the raw role)", () => {
    render(<CharacterRefView {...mockProps({ usageMode: "face" })} />)
    expect(document.querySelector(".character-ref-pill__mode-badge")?.textContent).toBe("Face only")
  })
})
