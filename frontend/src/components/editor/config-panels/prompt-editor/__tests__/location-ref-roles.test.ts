import { describe, it, expect } from "vitest"
import { generateText, type JSONContent } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { isLocationUsageMode, normalizeRoleSlug, REFERENCE_ROLE_PRESETS } from "@nodaro/shared"
import {
  LOCATION_ROLE_PRESETS,
  locationSwapMenuRoles,
  roleToLocationRefSlots,
  sanitizeLocationRole,
} from "../location-ref-roles"
import {
  LocationRefExtension,
  parseLocationRefMatch,
  type LocationRefAttrs,
} from "../location-ref-extension"

/**
 * LOGIC contract for the hybrid LOCATION-pill role-label picker (Phase D Task
 * 3 + F2 follow-up — curated presets PLUS a free-form Custom… input, now that
 * the location parser accepts any bare non-mode slug as a role). The menu
 * rendering is visual (human staging check); these tests pin the load-bearing
 * logic:
 *
 *   1. the hybrid/legacy GATE — role presets in hybrid, the unchanged
 *      usage-mode menu (gate → null) in legacy;
 *   2. role → token-slot mapping. A location token is role XOR bucket/variant
 *      XOR mode. Genuine roles land in `role`; the two presets that are ALSO
 *      LocationUsageModes (`layout` / `style`) land in `usageMode` — the
 *      parser-stable slot, because the D1 parser resolves a bare `@loc:1:layout`
 *      to a usage mode, never a role. Either way bucket/variant are cleared;
 *   3. the resulting locationRef node round-trips to the EXACT literal token via
 *      the extension's real `renderText`, and re-parses (real
 *      `parseLocationRefMatch`) to an idempotent attr set.
 */

const EXTENSIONS = [Document, Paragraph, Text, LocationRefExtension]

/** Serialize a locationRef node (given its slot attrs) to plain text via the
 *  extension's real `renderText` — what `editor.getText()` emits and what flows
 *  downstream to the shared `parseLocationMentionToken`. */
function tokenFor(slots: {
  role: string | null
  usageMode: LocationRefAttrs["usageMode"]
  bucket: string | null
  variant: string | null
}): string {
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
  return generateText(doc, EXTENSIONS, { blockSeparator: "\n" })
}

describe("locationSwapMenuRoles — hybrid/legacy gate", () => {
  it("returns the curated wired-location role presets in hybrid", () => {
    expect(locationSwapMenuRoles("hybrid")).toEqual([
      "background",
      "atmosphere",
      "as-is",
      "empty background",
      "layout",
      "lighting",
      "style",
    ])
  })

  it("returns null in legacy (caller renders the unchanged usage-mode menu)", () => {
    expect(locationSwapMenuRoles("legacy")).toBeNull()
  })

  it("LOCATION_ROLE_PRESETS mirrors the shared registry order", () => {
    expect(LOCATION_ROLE_PRESETS).toEqual(REFERENCE_ROLE_PRESETS["wired-location"])
    expect(LOCATION_ROLE_PRESETS).toEqual(locationSwapMenuRoles("hybrid"))
  })
})

describe("roleToLocationRefSlots — role → token slot (role XOR usageMode; bucket/variant cleared)", () => {
  it("(a) a genuine role preset (background) → role slot, everything else cleared", () => {
    expect(roleToLocationRefSlots("background")).toEqual({
      role: "background",
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("genuine role presets atmosphere / lighting → role slot", () => {
    expect(roleToLocationRefSlots("atmosphere")).toEqual({
      role: "atmosphere",
      usageMode: null,
      bucket: null,
      variant: null,
    })
    expect(roleToLocationRefSlots("lighting")).toEqual({
      role: "lighting",
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("(b) a multi-word role (empty background) → slug 'empty-background' in the role slot", () => {
    expect(roleToLocationRefSlots("empty background")).toEqual({
      role: "empty-background",
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("the hyphen-keyed role (as-is) stays 'as-is' in the role slot", () => {
    expect(roleToLocationRefSlots("as-is")).toEqual({
      role: "as-is",
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("a preset that is ALSO a LocationUsageMode (layout) → usageMode slot (parser-stable)", () => {
    expect(roleToLocationRefSlots("layout")).toEqual({
      role: null,
      usageMode: "layout",
      bucket: null,
      variant: null,
    })
  })

  it("style (also a LocationUsageMode) → usageMode slot", () => {
    expect(roleToLocationRefSlots("style")).toEqual({
      role: null,
      usageMode: "style",
      bucket: null,
      variant: null,
    })
  })

  it("a blank role clears ALL slots (the Default state)", () => {
    expect(roleToLocationRefSlots("")).toEqual({
      role: null,
      usageMode: null,
      bucket: null,
      variant: null,
    })
    expect(roleToLocationRefSlots("   ")).toEqual({
      role: null,
      usageMode: null,
      bucket: null,
      variant: null,
    })
  })

  it("INVARIANT: every preset lands in EXACTLY ONE of {role, usageMode}; bucket/variant always null", () => {
    for (const preset of LOCATION_ROLE_PRESETS) {
      const slots = roleToLocationRefSlots(preset)
      expect(slots.bucket).toBeNull()
      expect(slots.variant).toBeNull()
      const filled = [slots.role, slots.usageMode].filter((v) => v !== null)
      // Exactly one slot filled → never an invalid multi-segment token.
      expect(filled).toHaveLength(1)
      // The filled slot, normalized back to a phrase, equals the preset.
      expect(normalizeRoleSlug(filled[0] as string)).toBe(preset)
      // And it lands in the slot the LocationUsageMode-ness predicts.
      const slug = sanitizeLocationRole(preset)
      if (isLocationUsageMode(slug)) {
        expect(slots.usageMode).toBe(slug)
        expect(slots.role).toBeNull()
      } else {
        expect(slots.role).toBe(slug)
        expect(slots.usageMode).toBeNull()
      }
    }
  })
})

describe("sanitizeLocationRole — location slug grammar [a-z][a-z0-9-]*", () => {
  it("passes a clean single-word role through unchanged", () => {
    expect(sanitizeLocationRole("background")).toBe("background")
  })

  it("dash-joins internal whitespace (empty background → empty-background)", () => {
    expect(sanitizeLocationRole("empty background")).toBe("empty-background")
  })

  it("preserves an already-hyphenated role (as-is)", () => {
    expect(sanitizeLocationRole("as-is")).toBe("as-is")
  })

  it("lower-cases and trims the ends", () => {
    expect(sanitizeLocationRole("  Empty Background  ")).toBe("empty-background")
  })

  it("returns empty for blank input", () => {
    expect(sanitizeLocationRole("")).toBe("")
    expect(sanitizeLocationRole("   ")).toBe("")
  })
})

describe("token round-trip — role slot → literal @oldlibrary:1:<slug> → real parser", () => {
  it("(a) background → @oldlibrary:1:background → re-parses to role 'background'", () => {
    const token = tokenFor(roleToLocationRefSlots("background"))
    expect(token).toBe("@oldlibrary:1:background")
    const parsed = parseLocationRefMatch(token)
    expect(parsed).toMatchObject({
      role: "background",
      bucket: null,
      variant: null,
      usageMode: null,
    })
  })

  it("(b) empty background → @oldlibrary:1:empty-background → role 'empty-background' → phrase 'empty background'", () => {
    const token = tokenFor(roleToLocationRefSlots("empty background"))
    expect(token).toBe("@oldlibrary:1:empty-background")
    const parsed = parseLocationRefMatch(token)
    expect(parsed?.role).toBe("empty-background")
    // The resolver/pill normalize the slug back to the phrase for display.
    expect(normalizeRoleSlug(parsed!.role!)).toBe("empty background")
  })

  it("layout (usageMode-overlapping) → @oldlibrary:1:layout → re-parses to usageMode 'layout' (parser-stable)", () => {
    const token = tokenFor(roleToLocationRefSlots("layout"))
    expect(token).toBe("@oldlibrary:1:layout")
    const parsed = parseLocationRefMatch(token)
    expect(parsed).toMatchObject({
      usageMode: "layout",
      role: null,
      bucket: null,
      variant: null,
    })
  })

  it("the Default state (all slots null) → clean @oldlibrary:1", () => {
    expect(tokenFor(roleToLocationRefSlots(""))).toBe("@oldlibrary:1")
  })

  it("(F2) a CUSTOM role ('Rooftop View') → sanitized slug → token → re-parses to role", () => {
    // Mirrors the pill's Custom… input path: raw phrase → roleToLocationRefSlots
    // (sanitizeLocationRole) → role slot → renderText token → shared parser.
    const slots = roleToLocationRefSlots("Rooftop View")
    expect(slots).toEqual({
      role: "rooftop-view",
      usageMode: null,
      bucket: null,
      variant: null,
    })
    const token = tokenFor(slots)
    expect(token).toBe("@oldlibrary:1:rooftop-view")
    const parsed = parseLocationRefMatch(token)
    expect(parsed).toMatchObject({
      role: "rooftop-view",
      usageMode: null,
      bucket: null,
      variant: null,
    })
    // A custom slug passes through normalizeRoleSlug unchanged (not a preset).
    expect(normalizeRoleSlug(parsed!.role!)).toBe("rooftop-view")
  })

  it("EVERY preset → clean 3-part token AND parse→render is idempotent (text-stable)", () => {
    for (const preset of LOCATION_ROLE_PRESETS) {
      const slug = sanitizeLocationRole(preset)
      const token = tokenFor(roleToLocationRefSlots(preset))
      expect(token).toBe(`@oldlibrary:1:${slug}`)
      // Exactly two colons → 3-part token, never an invalid multi-segment shape.
      expect(token.split(":")).toHaveLength(3)
      const parsed = parseLocationRefMatch(token)
      expect(parsed).not.toBeNull()
      // Re-render the parsed attrs → identical token. Holds even for the two
      // presets that flip role→usageMode internally (layout/style).
      expect(
        tokenFor({
          role: parsed!.role,
          usageMode: parsed!.usageMode,
          bucket: parsed!.bucket,
          variant: parsed!.variant,
        }),
      ).toBe(token)
    }
  })
})
