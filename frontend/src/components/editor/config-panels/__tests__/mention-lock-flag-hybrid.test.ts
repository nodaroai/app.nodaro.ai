import { describe, it, expect, vi } from "vitest"

/**
 * FE round-trip for the per-mention identity-lock `~lock` sentinel (Task 4),
 * HYBRID format. Pins:
 *   - `parseLocationRefMatch` surfaces `lock:true` (format-blind).
 *   - `collectTokens` promotes a `~lock` token to a pill with `lock:true`
 *     (character + location) in hybrid, and carries the role.
 *   - `renderText` re-serializes the `~lock` sentinel LAST.
 *   - A lock-less token stays byte-identical (lock ABSENT → inherit).
 *   - Task F4: the symmetric `~nolock` force-off round-trips (parse → attr →
 *     renderText) as tri-state `lock:false`.
 */
vi.mock("@/lib/image-reference-format", () => ({ IMAGE_REFERENCE_FORMAT: "hybrid" }))

import {
  parseLocationRefMatch,
  LocationRefExtension,
} from "../prompt-editor/location-ref-extension"
import {
  parseCharacterRefMatch,
  CharacterRefExtension,
} from "../prompt-editor/character-ref-extension"
import { collectTokens, type KnownSlugSets } from "../prompt-editor"

function known(opts: { chars?: string[]; locs?: string[] } = {}): KnownSlugSets {
  return { characters: new Set(opts.chars ?? []), locations: new Set(opts.locs ?? []), snippets: [] }
}

// renderText is defined on the Node.create config; call it with a fake node.
/* eslint-disable @typescript-eslint/no-explicit-any */
const charText = (attrs: Record<string, unknown>) =>
  (CharacterRefExtension.config as any).renderText({ node: { attrs } })
const locText = (attrs: Record<string, unknown>) =>
  (LocationRefExtension.config as any).renderText({ node: { attrs } })
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("parseLocationRefMatch — ~lock / ~nolock (format-blind)", () => {
  it("surfaces lock:true on a role token", () => {
    expect(parseLocationRefMatch("@old-library:1:background~lock")).toEqual({
      locationSlug: "old-library", imageIndex: 1, bucket: null, variant: null,
      usageMode: null, role: "background", lock: true,
    })
  })
  it("surfaces lock:false on a ~nolock role token (Task F4)", () => {
    expect(parseLocationRefMatch("@old-library:1:background~nolock")).toEqual({
      locationSlug: "old-library", imageIndex: 1, bucket: null, variant: null,
      usageMode: null, role: "background", lock: false,
    })
  })
  it("BYTE-IDENTICAL: lock-less token gains no lock key", () => {
    const attrs = parseLocationRefMatch("@old-library:1:background")
    expect(attrs).not.toHaveProperty("lock")
  })
})

describe("parseCharacterRefMatch — tri-state lock passthrough", () => {
  it("includes lock:true when the caller detects ~lock", () => {
    expect(parseCharacterRefMatch("@kira", "1", "face", undefined, true)).toEqual({
      characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: "face", role: null, lock: true,
    })
  })
  it("includes lock:false when the caller detects ~nolock (Task F4)", () => {
    expect(parseCharacterRefMatch("@kira", "1", "face", undefined, false)).toEqual({
      characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: "face", role: null, lock: false,
    })
  })
  it("BYTE-IDENTICAL: no lock key when lock arg omitted (undefined)", () => {
    expect(parseCharacterRefMatch("@kira", "1", "face", undefined)).not.toHaveProperty("lock")
  })
})

describe("collectTokens — ~lock promotion (hybrid)", () => {
  it("character @kira:1:face~lock → characterRef with lock:true", () => {
    const out = collectTokens("@kira:1:face~lock runs", known({ chars: ["kira"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
    expect(out[0].node.attrs).toMatchObject({
      characterSlug: "kira", imageIndex: 1, usageMode: "face", lock: true,
    })
    // Span covers the full sentinel token.
    expect("@kira:1:face~lock runs".slice(out[0].start, out[0].end)).toBe("@kira:1:face~lock")
  })

  it("location @old-library:1:background~lock → locationRef with role + lock:true", () => {
    const out = collectTokens("at @old-library:1:background~lock now", known({ locs: ["old-library"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
    expect(out[0].node.attrs).toMatchObject({
      locationSlug: "old-library", imageIndex: 1, role: "background", lock: true,
    })
  })

  it("BYTE-IDENTICAL: lock-less character token → lock inherit (not false)", () => {
    const out = collectTokens("@kira:1:face runs", known({ chars: ["kira"] }))
    expect(out[0].node.attrs).toMatchObject({ characterSlug: "kira", usageMode: "face" })
    // Tri-state (Task F4): neither sentinel → lock is undefined (inherit), NOT
    // false — false would emit a spurious `~nolock` on re-serialize.
    expect(out[0].node.attrs?.lock).toBeUndefined()
    expect(charText(out[0].node.attrs as Record<string, unknown>)).toBe("@kira:1:face")
  })

  it("character @kira:1:face~nolock → characterRef with lock:false (Task F4)", () => {
    const out = collectTokens("@kira:1:face~nolock runs", known({ chars: ["kira"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.attrs).toMatchObject({ characterSlug: "kira", usageMode: "face", lock: false })
    expect("@kira:1:face~nolock runs".slice(out[0].start, out[0].end)).toBe("@kira:1:face~nolock")
  })

  it("location @old-library:1:background~nolock → locationRef with role + lock:false (Task F4)", () => {
    const out = collectTokens("at @old-library:1:background~nolock now", known({ locs: ["old-library"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.attrs).toMatchObject({
      locationSlug: "old-library", imageIndex: 1, role: "background", lock: false,
    })
  })
})

describe("renderText — re-serializes the tri-state lock sentinel LAST", () => {
  it("character: lock:true appends ~lock after the mode", () => {
    expect(charText({ characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: "face", lock: true }))
      .toBe("@kira:1:face~lock")
  })
  it("character: lock:false appends ~nolock (force off, Task F4)", () => {
    expect(charText({ characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: "face", lock: false }))
      .toBe("@kira:1:face~nolock")
  })
  it("character: lock undefined → no sentinel (inherit)", () => {
    expect(charText({ characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: "face", lock: undefined }))
      .toBe("@kira:1:face")
  })
  it("location: role + lock:true → ~lock last", () => {
    expect(locText({ locationSlug: "old-library", imageIndex: 1, bucket: null, variant: null, usageMode: null, role: "background", lock: true }))
      .toBe("@old-library:1:background~lock")
  })
  it("location: role + lock:false → ~nolock last (Task F4)", () => {
    expect(locText({ locationSlug: "old-library", imageIndex: 1, bucket: null, variant: null, usageMode: null, role: "background", lock: false }))
      .toBe("@old-library:1:background~nolock")
  })
})
