import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Phase D restored-legacy guard for the FE location pill promotion (the review
 * blocker mirror). The additive parser now PARSES a bare-slug ROLE token
 * (`@old-library:1:background` / `:atmosphere` / `:as-is` / `:empty-background`
 * / `:lighting`), but the extension's typed-text/paste→pill INPUT RULE must NOT
 * auto-promote it in LEGACY (it stayed plain text pre-Phase-D). In HYBRID the
 * promotion is kept.
 *
 * `resolvePromotableAttrs` is the exact decision function both the input rule
 * and the paste rule call, so unit-testing it is a faithful test of the gate
 * (driving the real TipTap input rule end-to-end in jsdom is impractical). The
 * reference-format constant is mocked via a hoisted holder so this one file can
 * drive BOTH formats — `resolvePromotableAttrs` reads the live binding at call
 * time, so flipping `fmt.value` between tests is enough.
 */
const fmt = vi.hoisted(() => ({ value: "legacy" as "legacy" | "hybrid" }))

vi.mock("@/lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return fmt.value
  },
}))

// eslint-disable-next-line import/first
import {
  resolvePromotableAttrs,
  parseLocationRefMatch,
} from "../prompt-editor/location-ref-extension"
// eslint-disable-next-line import/first
import { collectTokens, type KnownSlugSets } from "../prompt-editor"

/** Minimal fake extension exposing the editor storage shape `knownLocationSlugs`
 *  reads (the `locationRef.referenceImages` list of `{ locationSlug }`). */
function ext(locs: string[]): { editor: unknown } {
  return {
    editor: {
      storage: {
        locationRef: { referenceImages: locs.map((s) => ({ locationSlug: s })) },
      },
    },
  }
}

const KNOWN = ext(["old-library"])

// The five bare-slug roles that previously parsed to null (stayed literal) and
// now parse with `role` set. `layout` / `style` are LocationUsageModes (they set
// `usageMode`, not `role`) so they are intentionally NOT in this list.
const ROLE_TOKENS = [
  "@old-library:1:background",
  "@old-library:1:atmosphere",
  "@old-library:1:as-is",
  "@old-library:1:empty-background",
  "@old-library:1:lighting",
]

describe("root cause: the parser accepts these role tokens (gate, not parser, controls promotion)", () => {
  it("parseLocationRefMatch parses every role token with `role` set", () => {
    for (const token of ROLE_TOKENS) {
      const attrs = parseLocationRefMatch(token)
      expect(attrs, token).not.toBeNull()
      expect(attrs?.role, token).toBeTruthy()
      expect(attrs?.bucket).toBeNull()
      expect(attrs?.variant).toBeNull()
      expect(attrs?.usageMode).toBeNull()
    }
  })
})

describe("LEGACY: role tokens are NOT auto-promoted (stay literal text)", () => {
  beforeEach(() => {
    fmt.value = "legacy"
  })

  it("every bare-slug role token returns false (no pill)", () => {
    for (const token of ROLE_TOKENS) {
      expect(resolvePromotableAttrs(token, KNOWN), token).toBe(false)
    }
  })

  it("non-role tokens still promote in legacy (canonical / bucket-variant / usage mode)", () => {
    // Canonical — unchanged.
    expect(resolvePromotableAttrs("@old-library:1", KNOWN)).toMatchObject({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
      role: null,
    })
    // Bucket/variant — unchanged.
    expect(resolvePromotableAttrs("@old-library:1:weather/rain", KNOWN)).toMatchObject({
      bucket: "weather",
      variant: "rain",
      role: null,
    })
    // `:layout` / `:style` are usage modes (role stays null) → still promoted.
    expect(resolvePromotableAttrs("@old-library:1:layout", KNOWN)).toMatchObject({
      usageMode: "layout",
      role: null,
    })
    expect(resolvePromotableAttrs("@old-library:1:style", KNOWN)).toMatchObject({
      usageMode: "style",
      role: null,
    })
  })

  it("unknown slug still returns false (known-slug gate is independent of the role gate)", () => {
    expect(resolvePromotableAttrs("@old-library:1:background", ext(["somewhere-else"]))).toBe(false)
    expect(resolvePromotableAttrs("@old-library:1", ext(["somewhere-else"]))).toBe(false)
  })
})

describe("HYBRID: role tokens ARE auto-promoted to a role pill", () => {
  beforeEach(() => {
    fmt.value = "hybrid"
  })

  it("@old-library:1:background promotes with role 'background'", () => {
    expect(resolvePromotableAttrs("@old-library:1:background", KNOWN)).toMatchObject({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
      role: "background",
    })
  })

  it("every bare-slug role token promotes (role preserved verbatim)", () => {
    for (const token of ROLE_TOKENS) {
      const attrs = resolvePromotableAttrs(token, KNOWN)
      expect(attrs, token).not.toBe(false)
      expect((attrs as { role: string }).role, token).toBeTruthy()
    }
  })
})

/**
 * The valueToDoc scanner (`collectTokens`) is the OTHER text→pill promotion
 * path (initial content + external value sync). It must carry the same legacy
 * role gate as the input/paste rule, else a saved legacy prompt would flip
 * text→pill on reload. Driven through the same hoisted format holder.
 */
function known(locs: string[]): KnownSlugSets {
  return { characters: new Set(), locations: new Set(locs), snippets: [] }
}

describe("collectTokens (valueToDoc) honors the legacy role gate", () => {
  it("LEGACY: a role token does NOT become a locationRef node (stays text)", () => {
    fmt.value = "legacy"
    for (const token of ROLE_TOKENS) {
      const out = collectTokens(`${token} a scene`, known(["old-library"]))
      expect(out, token).toEqual([])
    }
  })

  it("LEGACY: canonical + usage-mode tokens still promote (unchanged)", () => {
    fmt.value = "legacy"
    const canonical = collectTokens("@old-library:1 here", known(["old-library"]))
    expect(canonical).toHaveLength(1)
    expect(canonical[0].node.type).toBe("locationRef")

    const mode = collectTokens("@old-library:1:layout here", known(["old-library"]))
    expect(mode).toHaveLength(1)
    expect(mode[0].node.attrs).toMatchObject({ usageMode: "layout" })
  })

  it("HYBRID: a role token DOES become a locationRef node", () => {
    fmt.value = "hybrid"
    const out = collectTokens("@old-library:1:background a scene", known(["old-library"]))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
  })
})
