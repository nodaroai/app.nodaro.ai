import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"
import { resolveVideoReferenceCore, type VideoExtraRef } from "@nodaro/prompts"

import { bindReferenceTokens, deriveDirectingReferences } from "../directing-references"

/**
 * The Directing reference SPLIT (replaces the old prose-guide bridge): bound
 * `@`-entity chips ride the STRUCTURED `connectedReferences` channel — the
 * `/v1/generate-video` route binds each to its `@image_N` attachment + identity
 * directive server-side (canvas-parity) — while the manual rail uploads ride the
 * flat `referenceImageUrls` channel. Studio writes no image into the prompt —
 * a bound chip is tied to its slot with the platform's `{image:N}` token (below).
 *
 * Slot reservation: flat refs LEAD the server's `@image_N` numbering, so the rail
 * is capped at `imageLimit - reservedByChips` to keep room for the identity-
 * critical chip attachments. Cross-channel dedup: a rail url equal to a chip url is
 * dropped (the chip wins — sending both would double-attach + misalign the slots).
 */

function charRef(id: string, url: string): ConnectedReference {
  return { id, defaultName: `char-${id}`, source: "wired-character", url }
}
function imageRef(id: string, url: string): ConnectedReference {
  return { id, defaultName: `img-${id}`, source: "wired-image", url, isExtraRef: true }
}

describe("deriveDirectingReferences", () => {
  it("passes chips through as connectedReferences verbatim (every source)", () => {
    const references = [
      charRef("c1", "https://r2/kira.png"),
      imageRef("i1", "https://r2/explosion.png"),
      {
        id: "l1",
        defaultName: "Old Library",
        source: "wired-location" as const,
        url: "https://r2/lib.png",
      },
    ]
    const { connectedReferences } = deriveDirectingReferences({
      references,
      railImageUrls: undefined,
      imageLimit: 9,
    })
    // Verbatim — no source-filtering, no transform (the route owns assembly).
    expect(connectedReferences).toEqual(references)
  })

  it("reserves a slot per unique chip url — the rail keeps only the remainder", () => {
    // limit 4, 2 unique chip urls → rail budget 2; 5 rail urls → first 2 survive.
    const references = [charRef("c1", "https://r2/a.png"), charRef("c2", "https://r2/b.png")]
    const railImageUrls = [
      "https://r2/r1.png",
      "https://r2/r2.png",
      "https://r2/r3.png",
      "https://r2/r4.png",
      "https://r2/r5.png",
    ]
    const { referenceImageUrls } = deriveDirectingReferences({
      references,
      railImageUrls,
      imageLimit: 4,
    })
    expect(referenceImageUrls).toEqual(["https://r2/r1.png", "https://r2/r2.png"])
  })

  it("drops a rail url that duplicates a chip url (cross-channel dedup — chip wins)", () => {
    const references = [charRef("c1", "https://r2/shared.png")]
    const railImageUrls = ["https://r2/shared.png", "https://r2/other.png"]
    const { connectedReferences, referenceImageUrls } = deriveDirectingReferences({
      references,
      railImageUrls,
      imageLimit: 9,
    })
    // The shared url stays ONLY on the chip; the flat list keeps just the distinct ref.
    expect(referenceImageUrls).toEqual(["https://r2/other.png"])
    expect(connectedReferences).toHaveLength(1)
  })

  it("passes ALL chips through even when they exceed the limit; the rail gets nothing", () => {
    // 5 chips, limit 4 → chips reserve the whole budget → rail 0; chips still ride
    // in FULL (the route slices to the provider cap, not studio).
    const references = [
      charRef("c1", "https://r2/1.png"),
      charRef("c2", "https://r2/2.png"),
      charRef("c3", "https://r2/3.png"),
      charRef("c4", "https://r2/4.png"),
      charRef("c5", "https://r2/5.png"),
    ]
    const { connectedReferences, referenceImageUrls } = deriveDirectingReferences({
      references,
      railImageUrls: ["https://r2/rail.png"],
      imageLimit: 4,
    })
    expect(connectedReferences).toHaveLength(5)
    expect(referenceImageUrls).toBeUndefined()
  })

  it("does NOT reserve a slot for a chip with an empty url", () => {
    const references = [
      { id: "empty", defaultName: "no-url", source: "wired-image" as const, url: "" },
      charRef("c1", "https://r2/a.png"),
    ]
    // Only 1 non-empty chip url reserves 1 of the limit-2 → the rail keeps 1 slot.
    const { referenceImageUrls } = deriveDirectingReferences({
      references,
      railImageUrls: ["https://r2/r1.png", "https://r2/r2.png"],
      imageLimit: 2,
    })
    expect(referenceImageUrls).toEqual(["https://r2/r1.png"])
  })

  it("de-dupes rail urls among themselves, preserving first-seen order", () => {
    const { referenceImageUrls } = deriveDirectingReferences({
      references: [],
      railImageUrls: ["https://r2/a.png", "https://r2/b.png", "https://r2/a.png"],
      imageLimit: 9,
    })
    expect(referenceImageUrls).toEqual(["https://r2/a.png", "https://r2/b.png"])
  })

  it("returns undefined for both channels when there is nothing to send", () => {
    expect(
      deriveDirectingReferences({ references: [], railImageUrls: undefined, imageLimit: 9 }),
    ).toEqual({ connectedReferences: undefined, referenceImageUrls: undefined })
    expect(
      deriveDirectingReferences({ references: [], railImageUrls: [], imageLimit: 9 }),
    ).toEqual({ connectedReferences: undefined, referenceImageUrls: undefined })
  })

  it("does not mutate its inputs and returns fresh arrays", () => {
    const references = [charRef("c1", "https://r2/a.png")]
    const railImageUrls = ["https://r2/a.png", "https://r2/b.png"]
    const refSnapshot = [...references]
    const railSnapshot = [...railImageUrls]
    const out = deriveDirectingReferences({ references, railImageUrls, imageLimit: 9 })
    expect(references).toEqual(refSnapshot)
    expect(railImageUrls).toEqual(railSnapshot)
    // Fresh array identity — not the caller's input reference.
    expect(out.connectedReferences).not.toBe(references)
  })
})

// ── The chip → `{ref:<id>}` binding ─────────────────────────────────────────

/**
 * THE REPORT'S SCENE (2026-08-30): one rail image, two character chips (a
 * canonical one and a VIEW — `isExtraRef`), an image chip per shot. The route
 * numbers them itself; studio names each chip by ITS OWN id with the
 * platform's id-addressed token and never computes a seat.
 */
const RAIL = ["https://cdn.example/rail.png"]
const IRIS: ConnectedReference = {
  id: "iris:medallion",
  defaultName: "Iris",
  source: "wired-character",
  url: "https://cdn.example/iris-medallion.jpg",
  characterSlug: "iris",
  variantSlug: "medallion",
  isExtraRef: true,
  description: "Wearing the medallion",
}
const WOMAN: ConnectedReference = {
  id: "woman-6",
  defaultName: "Early 20s Beautiful Woman 6",
  source: "wired-character",
  url: "https://cdn.example/woman-6.png",
  characterSlug: "early-20s-beautiful-woman-6",
}
function namedImage(name: string, url: string): ConnectedReference {
  return {
    id: url,
    defaultName: name,
    source: "wired-image",
    url,
    isExtraRef: true,
    description: name,
  }
}
// The OLD auto-label, on purpose. New image chips are named `Ref N`, but a chip
// bound before the rename keeps the name it was stored with — and the binder
// replaces by `source === "wired-image"`, never by name pattern. These are the
// legacy-chip regression proof; do not tidy them to `Ref`.
const IMAGE_4 = namedImage("Image 4", "https://cdn.example/img-4.jpg")
const IMAGE_6 = namedImage("Image 6", "https://cdn.example/img-6.jpg")
const SCENE = [IRIS, WOMAN, IMAGE_4, IMAGE_6]
const SEEDANCE_IMAGES = 9
const channels = (imageLimit = SEEDANCE_IMAGES, rail: ReadonlyArray<string> | undefined = RAIL) => ({
  connectedReferences: SCENE,
  referenceImageUrls: rail,
  imageLimit,
})

/** The platform's own token grammar (`ref-id-tokens.ts`): `{ref:` + a
 *  brace-free content + `}`; the id is matched by identity, so a URL is fine. */
const PLATFORM_REF_TOKEN = /\{[rR][eE][fF]:([^{}]*)\}/g

describe("bindReferenceTokens — a chip's name in the prose becomes its id token", () => {
  it("replaces an image chip's label with `{ref:<its id>}`, and tags an entity chip after its name", () => {
    // "Image 6" is the platform's OWN ordinal grammar — as a name it told the
    // model to look at the sixth attachment. The token names the picture by
    // the chip's id; the route seats it after IT has numbered the references.
    expect(
      bindReferenceTokens(
        "Iris and Early 20s Beautiful Woman 6 walking together Image 4",
        channels(),
      ),
    ).toBe(
      "Iris ({ref:iris:medallion}) and Early 20s Beautiful Woman 6 ({ref:woman-6}) walking together {ref:https://cdn.example/img-4.jpg}",
    )
  })

  it("writes ONLY tokens the platform's grammar accepts — no brace in an id, ids by identity", () => {
    const bound = bindReferenceTokens("Iris walks to Image 4 then Image 6", channels())
    const contents = [...bound.matchAll(PLATFORM_REF_TOKEN)].map((m) => m[1])
    expect(contents).toEqual([IRIS.id, IMAGE_4.id, IMAGE_6.id])
    for (const c of contents) expect(c).not.toMatch(/[{}]/)
  })

  it("binds EVERY occurrence — each shot names the image it uses", () => {
    expect(bindReferenceTokens("0-6s — Image 4.\n6-14s — Image 4 then Image 6.", channels())).toBe(
      "0-6s — {ref:https://cdn.example/img-4.jpg}.\n6-14s — {ref:https://cdn.example/img-4.jpg} then {ref:https://cdn.example/img-6.jpg}.",
    )
  })

  it("whole words, longest name first — `Image 1` never claims `Image 10`, nor `Iris` a word inside another", () => {
    const one = namedImage("Image 1", "https://cdn.example/1.jpg")
    const ten = namedImage("Image 10", "https://cdn.example/10.jpg")
    expect(
      bindReferenceTokens("Image 10 beside Image 1; Irises bloom", {
        connectedReferences: [one, ten, IRIS],
        referenceImageUrls: undefined,
        imageLimit: SEEDANCE_IMAGES,
      }),
    ).toBe("{ref:https://cdn.example/10.jpg} beside {ref:https://cdn.example/1.jpg}; Irises bloom")
  })

  it("matches the exact case — a chip named Iris leaves the catalog's `iris wipe` alone", () => {
    // Transition terms fold lowercase ("iris wipe", "linear wipe"); a name is
    // inserted verbatim by the chip, so a case-insensitive match would bind a
    // wipe to a portrait.
    expect(bindReferenceTokens("iris wipe. Iris smiles.", channels())).toBe(
      "iris wipe. Iris ({ref:iris:medallion}) smiles.",
    )
  })

  it("leaves a chip the route will cap out as prose — the budget is the rail plus the chips, in order", () => {
    // 3 seats, one taken by the rail: the first two chips ride, the image chips
    // don't. The route would degrade their tokens to the name anyway; not
    // writing them keeps an entity chip from degrading to "Iris (Iris)".
    expect(bindReferenceTokens("Iris walks to Image 4", channels(3))).toBe(
      "Iris ({ref:iris:medallion}) walks to Image 4",
    )
    // No image support at all ⇒ nothing binds.
    expect(bindReferenceTokens("Iris walks to Image 4", channels(0))).toBe("Iris walks to Image 4")
  })

  it("skips a chip with no picture to seat, and leaves an unbound prompt untouched", () => {
    const nameOnly: ConnectedReference = { ...WOMAN, id: "ghost", url: "" }
    expect(
      bindReferenceTokens("Early 20s Beautiful Woman 6 waves", {
        connectedReferences: [nameOnly],
        referenceImageUrls: undefined,
        imageLimit: SEEDANCE_IMAGES,
      }),
    ).toBe("Early 20s Beautiful Woman 6 waves")
    const text = "nobody bound here"
    expect(bindReferenceTokens(text, { connectedReferences: undefined, referenceImageUrls: RAIL, imageLimit: 9 })).toBe(text)
    expect(bindReferenceTokens(text, channels())).toBe(text)
  })

  it("survives a name with regex characters", () => {
    const odd = namedImage("Shot (v2) [final]", "https://cdn.example/odd.jpg")
    expect(
      bindReferenceTokens("use Shot (v2) [final] here", {
        connectedReferences: [odd],
        referenceImageUrls: undefined,
        imageLimit: SEEDANCE_IMAGES,
      }),
    ).toBe("use {ref:https://cdn.example/odd.jpg} here")
  })

  it("end to end — the platform's own core seats every id token where the picture actually sits", () => {
    // @nodaro/prompts ≥ 1.10.0 ships the resolver the route runs. This
    // reproduces the route's few pre-core lines (cap the rail, give the chips
    // the remainder, split canonical wired characters from everything else,
    // carry each chip's id and name) and asserts the bound prose comes out
    // with the SAME @image_N the payload attaches the url at — no seat is
    // computed here, and none has to be.
    const leading = RAIL.slice(0, SEEDANCE_IMAGES)
    const capped = SCENE.slice(0, SEEDANCE_IMAGES - leading.length)
    const canonical = (r: ConnectedReference) => r.source === "wired-character" && !r.isExtraRef
    const extraRefs: VideoExtraRef[] = capped
      .filter((r) => !canonical(r))
      .map((r) => ({
        id: r.id,
        url: r.url,
        description: (r.description ?? "").trim() || r.defaultName,
        characterSlug: r.characterSlug,
        variantSlug: r.variantSlug,
      }))
    const folded =
      "0-6s — cross-dissolve. Iris and Early 20s Beautiful Woman 6 walking together Image 4, orbit left.\n" +
      "6-14s — linear wipe. Image 6\nThey start running fast."
    const core = resolveVideoReferenceCore({
      prompt: bindReferenceTokens(folded, channels()),
      wiredCharRefs: capped.filter(canonical),
      extraRefs,
      leadingRefUrls: leading,
      refNamesById: new Map(SCENE.map((r) => [r.id, r.defaultName])),
      videoRefCount: 0,
      audioRefCount: 0,
      hybridRoles: true,
    })
    expect(core.prompt).toContain(
      "0-6s — cross-dissolve. Iris (@image_3) and Early 20s Beautiful Woman 6 (@image_2) walking together @image_4, orbit left.\n" +
        "6-14s — linear wipe. @image_5\nThey start running fast.",
    )
    expect(core.prompt).not.toContain("{ref:")
    expect(core.additionalUrls).toEqual([RAIL[0], WOMAN.url, IRIS.url, IMAGE_4.url, IMAGE_6.url])
  })

  it("a chip the route caps out degrades to its NAME on the wire — never the raw token", () => {
    // VEO takes three: rail + Iris + Woman fill it; the images fall off the
    // walk. Studio already leaves capped chips as prose, but even if a token
    // reached the route it would read as the name — pinned on the real core.
    const core = resolveVideoReferenceCore({
      prompt: "then {ref:https://cdn.example/img-4.jpg} appears",
      wiredCharRefs: [WOMAN],
      extraRefs: [{ id: IRIS.id, url: IRIS.url, description: "view", characterSlug: "iris", variantSlug: "medallion" }],
      leadingRefUrls: RAIL,
      refNamesById: new Map(SCENE.map((r) => [r.id, r.defaultName])),
      videoRefCount: 0,
      audioRefCount: 0,
      hybridRoles: true,
    })
    expect(core.prompt).toContain("then Image 4 appears")
    expect(core.prompt).not.toContain("{ref:")
  })

  it("the report's two shots, each naming its own picture by id", () => {
    const folded =
      "0-6s — cross-dissolve. Iris and Early 20s Beautiful Woman 6 walking together Image 4, orbit left.\n" +
      "6-14s — linear wipe. Image 6\nThey start running fast."
    expect(bindReferenceTokens(folded, channels())).toBe(
      "0-6s — cross-dissolve. Iris ({ref:iris:medallion}) and Early 20s Beautiful Woman 6 ({ref:woman-6}) walking together {ref:https://cdn.example/img-4.jpg}, orbit left.\n" +
        "6-14s — linear wipe. {ref:https://cdn.example/img-6.jpg}\nThey start running fast.",
    )
  })
})
