import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"
import { createRef } from "react"
import { generateText, type JSONContent } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"

/**
 * HYBRID `@`-autocomplete role drill (Reference-Roles follow-up Task 1).
 *
 * When `IMAGE_REFERENCE_FORMAT === "hybrid"` the 3rd-level drill offers the
 * curated ROLE presets (character AND location) instead of the usage-mode
 * list. Picking a role fires `command({ ...item, role })`; the parent's
 * `command` handler (index.tsx) then routes that role through the Plan-D pure
 * helpers `roleTo{Character,Location}RefSlots` into a single token slot.
 *
 * The menu rendering itself is visual (human staging check). These tests pin
 * the LOAD-BEARING logic:
 *   1. the hybrid gate — the drill shows ROLE rows, not usage-mode rows;
 *   2. picking a role fires the right `command` payload (source + slug + role);
 *   3. the fired payload, routed through the SAME pure helper index.tsx uses,
 *      round-trips to the exact literal token via the real extension serializer.
 *
 * Legacy remains byte-identical — the existing `suggestion-list.test.tsx`
 * (which resolves to "legacy" in test runs) is the primary guard; a small
 * legacy-gate assertion here demonstrates the divergence in one file.
 *
 * The reference-format constant is mocked via a hoisted holder so a single
 * file can drive BOTH formats (SuggestionList reads it at render time, and so
 * do the `characterSwapMenuRoles`/`locationSwapMenuRoles` gates it calls).
 */
const fmt = vi.hoisted(() => ({ value: "hybrid" as "legacy" | "hybrid" }))

vi.mock("@/lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return fmt.value
  },
}))

// eslint-disable-next-line import/first
import {
  SuggestionList,
  type SuggestionListHandle,
  type SuggestionCommandPayload,
} from "../prompt-editor/suggestion-list"
// eslint-disable-next-line import/first
import { roleToCharacterRefSlots } from "../prompt-editor/character-ref-roles"
// eslint-disable-next-line import/first
import { roleToLocationRefSlots } from "../prompt-editor/location-ref-roles"
// eslint-disable-next-line import/first
import { CharacterRefExtension } from "../prompt-editor/character-ref-extension"
// eslint-disable-next-line import/first
import { LocationRefExtension } from "../prompt-editor/location-ref-extension"
// eslint-disable-next-line import/first
import type { RefImageItem } from "../tag-textarea"

// ── Round-trip serializers (mirror the pure-helper role tests) ─────────────
const CHAR_EXT = [Document, Paragraph, Text, CharacterRefExtension]
const LOC_EXT = [Document, Paragraph, Text, LocationRefExtension]

/** Serialize a characterRef with the slots the command handler would apply. */
function charToken(role: string): string {
  const slots = roleToCharacterRefSlots(role)
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "characterRef",
            attrs: {
              characterSlug: "kira",
              imageIndex: 1,
              variantSlug: slots.variantSlug,
              usageMode: slots.usageMode,
            },
          },
        ],
      },
    ],
  }
  return generateText(doc, CHAR_EXT, { blockSeparator: "\n" })
}

/** Serialize a locationRef with the slots the command handler would apply. */
function locToken(role: string): string {
  const slots = roleToLocationRefSlots(role)
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "locationRef",
            attrs: {
              locationSlug: "oldlibrary",
              imageIndex: 1,
              bucket: slots.bucket,
              variant: slots.variant,
              usageMode: slots.usageMode,
              role: slots.role,
            },
          },
        ],
      },
    ],
  }
  return generateText(doc, LOC_EXT, { blockSeparator: "\n" })
}

// ── Fixtures (match suggestion-list.test.tsx) ──────────────────────────────
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

const KIRA_REFS: RefImageItem[] = [
  characterRef({ characterSlug: "kira", label: "Kira", index: 1 }),
  characterRef({
    characterSlug: "kira",
    label: "Kira",
    variantSlug: "smile",
    variantDisplayName: "smile",
    index: 2,
  }),
]

const OLD_LIBRARY_REFS: RefImageItem[] = [
  locationRef({ locationSlug: "oldlibrary", label: "Old Library", index: 3 }),
  locationRef({
    locationSlug: "oldlibrary",
    label: "Old Library",
    bucket: "weather",
    variant: "rain",
    variantDisplayName: "rain",
    index: 4,
  }),
]

function renderList(items: RefImageItem[]) {
  const command = vi.fn<(item: SuggestionCommandPayload) => void>()
  const handle = createRef<SuggestionListHandle>()
  render(
    <SuggestionList
      ref={handle}
      items={items}
      query=""
      command={command}
      onDrillChange={() => {}}
    />,
  )
  return { command, handle }
}

function dispatchKey(handle: React.RefObject<SuggestionListHandle | null>, key: string) {
  act(() => {
    handle.current?.onKeyDown(new KeyboardEvent("keydown", { key }))
  })
}

function rootButton(kind: "character-root" | "location-root"): HTMLButtonElement {
  const match = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("data-row-kind") === kind)
  if (!match) throw new Error(`${kind} button not found`)
  return match as HTMLButtonElement
}

beforeEach(() => {
  fmt.value = "hybrid"
  cleanup()
})

describe("hybrid @-autocomplete drill — CHARACTER role picker (level 3)", () => {
  function drillToCharacterRolePicker() {
    const utils = renderList(KIRA_REFS)
    fireEvent.mouseDown(rootButton("character-root")) // level 2 (variants)
    dispatchKey(utils.handle, "ArrowRight") // level 3 (role picker in hybrid)
    return utils
  }

  it("offers the curated ROLE presets, not the usage-mode list", () => {
    drillToCharacterRolePicker()
    for (const role of ["person", "face", "clothes", "hair", "pose", "expression", "style"]) {
      expect(document.querySelector(`[data-row-kind='role'][data-role='${role}']`)).not.toBeNull()
    }
    // Legacy usage-mode-only labels never appear in the hybrid role drill.
    expect(screen.queryByText("Identical")).toBeNull()
    expect(screen.queryByText("Face only")).toBeNull()
    // No usage-mode rows rendered at all.
    expect(document.querySelector("[data-row-kind='mode']")).toBeNull()
  })

  it("(a) picking a UsageMode role (face) fires command with role → round-trips to @kira:1:face", () => {
    const { command } = drillToCharacterRolePicker()
    fireEvent.mouseDown(document.querySelector("[data-role='face']")!)
    expect(command).toHaveBeenCalledTimes(1)
    const payload = command.mock.calls[0][0]
    expect(payload).toMatchObject({ source: "character", characterSlug: "kira", role: "face" })
    // The role occupies usageMode, variantSlug cleared → clean 3-part token.
    expect(roleToCharacterRefSlots(payload.role!)).toEqual({ usageMode: "face", variantSlug: null })
    expect(charToken(payload.role!)).toBe("@kira:1:face")
  })

  it("(b) picking a role-only preset (clothes) → variantSlug slot → @kira:1:clothes", () => {
    const { command } = drillToCharacterRolePicker()
    fireEvent.mouseDown(document.querySelector("[data-role='clothes']")!)
    const payload = command.mock.calls[0][0]
    expect(payload.role).toBe("clothes")
    expect(roleToCharacterRefSlots(payload.role!)).toEqual({ usageMode: null, variantSlug: "clothes" })
    expect(charToken(payload.role!)).toBe("@kira:1:clothes")
  })

  it("every character role preset round-trips to a clean 3-part token", () => {
    for (const role of ["person", "face", "clothes", "hair", "pose", "expression", "style"]) {
      cleanup()
      const { command } = drillToCharacterRolePicker()
      fireEvent.mouseDown(document.querySelector(`[data-role='${role}']`)!)
      const payload = command.mock.calls[0][0]
      const token = charToken(payload.role!)
      expect(token).toBe(`@kira:1:${role}`)
      expect(token.split(":")).toHaveLength(3)
    }
  })
})

describe("hybrid @-autocomplete drill — LOCATION role picker (level 3)", () => {
  function drillToLocationRolePicker() {
    const utils = renderList(OLD_LIBRARY_REFS)
    fireEvent.mouseDown(rootButton("location-root")) // level 2 (variants)
    dispatchKey(utils.handle, "ArrowRight") // level 3 (role picker in hybrid)
    return utils
  }

  it("offers the curated LOCATION role presets, not the usage-mode list", () => {
    drillToLocationRolePicker()
    for (const role of ["background", "atmosphere", "as-is", "empty background", "layout", "lighting", "style"]) {
      expect(document.querySelector(`[data-row-kind='location-role'][data-role='${role}']`)).not.toBeNull()
    }
    // Legacy location usage-mode labels never appear in the hybrid role drill.
    expect(screen.queryByText("Match exactly")).toBeNull()
    expect(screen.queryByText("No textual bias")).toBeNull()
    expect(document.querySelector("[data-row-kind='location-mode']")).toBeNull()
  })

  it("(a) picking a genuine role (background) → role slot → @oldlibrary:3:background", () => {
    const { command } = drillToLocationRolePicker()
    fireEvent.mouseDown(document.querySelector("[data-role='background']")!)
    expect(command).toHaveBeenCalledTimes(1)
    const payload = command.mock.calls[0][0]
    expect(payload).toMatchObject({ source: "location", locationSlug: "oldlibrary", role: "background" })
    expect(roleToLocationRefSlots(payload.role!)).toEqual({
      role: "background",
      usageMode: null,
      bucket: null,
      variant: null,
    })
    // Canonical entry (index 3) — the token uses its imageIndex.
    expect(locToken(payload.role!)).toBe("@oldlibrary:1:background")
  })

  it("(b) a usageMode-overlapping role (layout) → usageMode slot (parser-stable)", () => {
    const { command } = drillToLocationRolePicker()
    fireEvent.mouseDown(document.querySelector("[data-role='layout']")!)
    const payload = command.mock.calls[0][0]
    expect(payload.role).toBe("layout")
    expect(roleToLocationRefSlots(payload.role!)).toEqual({
      role: null,
      usageMode: "layout",
      bucket: null,
      variant: null,
    })
    expect(locToken(payload.role!)).toBe("@oldlibrary:1:layout")
  })

  it("(c) a multi-word role (empty background) serializes to its slug @oldlibrary:1:empty-background", () => {
    const { command } = drillToLocationRolePicker()
    fireEvent.mouseDown(document.querySelector("[data-role='empty background']")!)
    const payload = command.mock.calls[0][0]
    expect(payload.role).toBe("empty background")
    expect(locToken(payload.role!)).toBe("@oldlibrary:1:empty-background")
  })
})

describe("legacy @-autocomplete drill — unchanged (usage-mode gate)", () => {
  beforeEach(() => {
    fmt.value = "legacy"
    cleanup()
  })

  it("the character 3rd-level drill shows usage modes, not roles", () => {
    const utils = renderList(KIRA_REFS)
    fireEvent.mouseDown(rootButton("character-root"))
    dispatchKey(utils.handle, "ArrowRight")
    // Legacy: usage-mode rows, no role rows.
    expect(document.querySelector("[data-row-kind='mode']")).not.toBeNull()
    expect(document.querySelector("[data-row-kind='role']")).toBeNull()
    expect(screen.getByText("Identical")).toBeInTheDocument()
  })

  it("picking a legacy usage mode fires command with usageMode (no role field)", () => {
    const utils = renderList(KIRA_REFS)
    fireEvent.mouseDown(rootButton("character-root"))
    dispatchKey(utils.handle, "ArrowRight")
    fireEvent.mouseDown(screen.getByText("Identical").closest("button")!)
    expect(utils.command).toHaveBeenCalledTimes(1)
    const payload = utils.command.mock.calls[0][0]
    expect(payload).toMatchObject({ source: "character", characterSlug: "kira", usageMode: "identical" })
    expect(payload.role).toBeUndefined()
  })
})
