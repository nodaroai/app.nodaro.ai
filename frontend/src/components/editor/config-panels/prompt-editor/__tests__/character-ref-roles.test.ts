import { describe, it, expect } from "vitest"
import { generateText, type JSONContent } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { isUsageMode } from "@nodaro/shared"
import {
  CHARACTER_ROLE_PRESETS,
  characterSwapMenuRoles,
  sanitizeRole,
  roleToCharacterRefSlots,
} from "../character-ref-roles"
import { CharacterRefExtension } from "../character-ref-extension"

/**
 * LOGIC contract for the hybrid character-pill role-label picker (Phase D
 * Task 2). The menu rendering itself is visual (human staging check); these
 * tests pin the load-bearing logic:
 *
 *   1. role → token-slot mapping (UsageMode → `usageMode`, else `variantSlug`,
 *      mutually exclusive);
 *   2. the resulting characterRef node round-trips to the EXACT literal token
 *      via the extension's real `renderText` (what `editor.getText()` emits and
 *      what flows downstream to the shared `parseCharacterMentionToken`);
 *   3. the hybrid/legacy GATE — role presets in hybrid, the unchanged
 *      usage-mode menu (gate → null) in legacy.
 */

const EXTENSIONS = [Document, Paragraph, Text, CharacterRefExtension]

/** Serialize a characterRef node (given its slot attrs) to plain text via the
 *  extension's real `renderText`. */
function tokenFor(slots: { usageMode: string | null; variantSlug: string | null }): string {
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
  return generateText(doc, EXTENSIONS, { blockSeparator: "\n" })
}

describe("characterSwapMenuRoles — hybrid/legacy gate", () => {
  it("returns the curated wired-character role presets in hybrid", () => {
    expect(characterSwapMenuRoles("hybrid")).toEqual([
      "ref-only",
      "person",
      "face",
      "clothes",
      "hair",
      "pose",
      "expression",
      "style",
    ])
  })

  it("returns null in legacy (caller renders the unchanged usage-mode menu)", () => {
    expect(characterSwapMenuRoles("legacy")).toBeNull()
  })

  it("CHARACTER_ROLE_PRESETS mirrors the shared registry order", () => {
    expect(CHARACTER_ROLE_PRESETS).toEqual(characterSwapMenuRoles("hybrid"))
  })
})

describe("roleToCharacterRefSlots — role → token slot", () => {
  it("(a) a UsageMode preset (face) → usageMode, variantSlug cleared", () => {
    expect(roleToCharacterRefSlots("face")).toEqual({ usageMode: "face", variantSlug: null })
  })

  it("a UsageMode preset (pose) → usageMode, variantSlug cleared", () => {
    expect(roleToCharacterRefSlots("pose")).toEqual({ usageMode: "pose", variantSlug: null })
  })

  it("a UsageMode preset (style) → usageMode, variantSlug cleared", () => {
    expect(roleToCharacterRefSlots("style")).toEqual({ usageMode: "style", variantSlug: null })
  })

  it("(b) a role-only preset (clothes) → variantSlug, usageMode cleared", () => {
    expect(roleToCharacterRefSlots("clothes")).toEqual({ usageMode: null, variantSlug: "clothes" })
  })

  it("role-only presets person/hair/expression → variantSlug", () => {
    expect(roleToCharacterRefSlots("person")).toEqual({ usageMode: null, variantSlug: "person" })
    expect(roleToCharacterRefSlots("hair")).toEqual({ usageMode: null, variantSlug: "hair" })
    expect(roleToCharacterRefSlots("expression")).toEqual({ usageMode: null, variantSlug: "expression" })
  })

  it("(c) a Custom role (Earrings) is sanitized → variantSlug", () => {
    expect(roleToCharacterRefSlots("Earrings")).toEqual({ usageMode: null, variantSlug: "earrings" })
  })

  it("a blank role clears BOTH slots (the Default state)", () => {
    expect(roleToCharacterRefSlots("")).toEqual({ usageMode: null, variantSlug: null })
    expect(roleToCharacterRefSlots("   ")).toEqual({ usageMode: null, variantSlug: null })
  })

  it("INVARIANT: every preset lands in EXACTLY ONE slot, verbatim", () => {
    for (const role of CHARACTER_ROLE_PRESETS) {
      const slots = roleToCharacterRefSlots(role)
      const filled = [slots.usageMode, slots.variantSlug].filter((v) => v !== null)
      // Exactly one slot is filled (never both → never an invalid 4-part token).
      expect(filled).toHaveLength(1)
      // The stored value equals the role verbatim (the D1 resolver reads it as-is).
      expect(filled[0]).toBe(role)
      // And it lands in the slot the UsageMode-ness predicts.
      if (isUsageMode(role)) {
        expect(slots.usageMode).toBe(role)
      } else {
        expect(slots.variantSlug).toBe(role)
      }
    }
  })
})

describe("sanitizeRole — character-variant-slug grammar [a-z][a-z0-9-]*", () => {
  it("passes a clean lowercase role through unchanged", () => {
    expect(sanitizeRole("earrings")).toBe("earrings")
  })

  it("lower-cases (proper-noun input)", () => {
    expect(sanitizeRole("Earrings")).toBe("earrings")
  })

  it("dash-joins internal whitespace and trims the ends", () => {
    expect(sanitizeRole("  gold ring  ")).toBe("gold-ring")
  })

  it("collapses dash runs (matches characterMentionSlug slugification)", () => {
    // "gold - ring" → whitespace-joins to "gold---ring", then dash-collapse.
    expect(sanitizeRole("gold - ring")).toBe("gold-ring")
    expect(sanitizeRole("gold  --  ring")).toBe("gold-ring")
  })

  it("drops a trailing dash", () => {
    expect(sanitizeRole("ring-")).toBe("ring")
    expect(sanitizeRole("ring - ")).toBe("ring")
  })

  it("drops out-of-grammar characters", () => {
    expect(sanitizeRole("a/b!c")).toBe("abc")
  })

  it("forces a leading letter (strips leading digits/dashes)", () => {
    expect(sanitizeRole("123lead")).toBe("lead")
    expect(sanitizeRole("--x")).toBe("x")
  })

  it("returns empty for content with no grammar-legal leading letter", () => {
    expect(sanitizeRole("123")).toBe("")
    expect(sanitizeRole("")).toBe("")
  })

  it("caps length at 32", () => {
    expect(sanitizeRole("a".repeat(50))).toHaveLength(32)
  })
})

describe("token round-trip — role slot → literal @kira:1:<role>", () => {
  it("(a) face (UsageMode) → @kira:1:face", () => {
    expect(tokenFor(roleToCharacterRefSlots("face"))).toBe("@kira:1:face")
  })

  it("(b) clothes (role-only) → @kira:1:clothes", () => {
    expect(tokenFor(roleToCharacterRefSlots("clothes"))).toBe("@kira:1:clothes")
  })

  it("(c) Custom earrings → @kira:1:earrings", () => {
    expect(tokenFor(roleToCharacterRefSlots("Earrings"))).toBe("@kira:1:earrings")
  })

  it("the Default state (both slots null) → clean @kira:1", () => {
    expect(tokenFor(roleToCharacterRefSlots(""))).toBe("@kira:1")
  })

  it("EVERY preset round-trips to a clean 3-part token (never 4-part)", () => {
    for (const role of CHARACTER_ROLE_PRESETS) {
      const token = tokenFor(roleToCharacterRefSlots(role))
      expect(token).toBe(`@kira:1:${role}`)
      // Exactly two colons → 3-part token, never the invalid 4-part shape.
      expect(token.split(":")).toHaveLength(3)
    }
  })
})
