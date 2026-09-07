import { describe, it, expect } from "vitest"
import { characterMentionSlug, type ConnectedReference } from "@nodaro/shared"

import type { Cast } from "../cast"
import { castForShots } from "../cast-bundle"
import { buildBundle, type BundleSource } from "../bundle/production-bundle"
import { parseBundle } from "../bundle/production-bundle-parse"
import type { Shot } from "../shot"

/**
 * C5's EXPORT half (spec 2026-08-31-project-cast-registry): "the bundle carries
 * the cast ONCE". Two things are pinned here and they pull against each other:
 * the sheet must reach the importer intact, and it must not be the WHOLE film's
 * sheet when one scene was exported.
 *
 * The legacy edge is pinned hardest, because it is the one that has to be
 * provably unchanged: a cast-less production must produce a bundle with no
 * `cast` key at all, or every pre-registry export changes shape for nothing.
 */

const KIRA: ConnectedReference = {
  id: "char-kira",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2.example/kira.png",
  characterSlug: characterMentionSlug("Kira"),
}

const CAST: Cast = {
  kira: { kind: "character", assetId: "char-kira", displayName: "Kira" },
  vale: { kind: "location", assetId: "loc-vale", displayName: "Vale" },
  jax: { kind: "character", assetId: "char-jax", displayName: "Jax" },
}

const shot = (id: string, over: Partial<Shot> = {}): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: "a frame",
    results: [{ url: `https://r2.example/${id}.png`, prompt: "a frame" }],
  },
  ...over,
})

const source = (shots: ReadonlyArray<Shot>, cast?: Cast): BundleSource => ({
  name: "Night Vale",
  shots,
  ...(cast ? { cast } : {}),
})

describe("castForShots — the sheet a slice actually needs", () => {
  it("carries a role its PROSE names (which is how a chip counts)", () => {
    const shots = [
      shot("s1", {
        still: {
          nodeId: "generate-image-s1",
          url: "https://r2.example/s1.png",
          provider: "nano-banana",
          prompt: "Kira on the roof",
          results: [{ url: "https://r2.example/s1.png", prompt: "Kira on the roof" }],
        },
      }),
    ]
    expect(Object.keys(castForShots(CAST, shots) ?? {})).toEqual(["kira"])
  })

  it("carries a role only a bound REFERENCE names — a recipe-less chip", () => {
    const shots = [
      shot("s1", {
        still: {
          nodeId: "generate-image-s1",
          url: "https://r2.example/s1.png",
          provider: "nano-banana",
          prompt: "she stands there",
          results: [
            { url: "https://r2.example/s1.png", prompt: "she stands there", references: [KIRA] },
          ],
        },
      }),
    ]
    expect(Object.keys(castForShots(CAST, shots) ?? {})).toEqual(["kira"])
  })

  it("carries a role this scene PINS, even with the name nowhere in the prose", () => {
    const shots = [
      shot("s1", { castLook: { vale: { url: "https://r2.example/vale-night.png" } } }),
    ]
    expect(Object.keys(castForShots(CAST, shots) ?? {})).toEqual(["vale"])
  })

  it("leaves out the roles this slice never mentions", () => {
    const shots = [
      shot("s1", {
        still: {
          nodeId: "generate-image-s1",
          url: "https://r2.example/s1.png",
          provider: "nano-banana",
          prompt: "Kira on the roof",
          results: [{ url: "https://r2.example/s1.png", prompt: "Kira on the roof" }],
        },
      }),
    ]
    expect(castForShots(CAST, shots)).not.toHaveProperty("jax")
    expect(castForShots(CAST, shots)).not.toHaveProperty("vale")
  })

  it("is UNDEFINED, never `{}`, when nothing is used or nothing is cast", () => {
    expect(castForShots(CAST, [shot("s1")])).toBeUndefined()
    expect(castForShots(undefined, [shot("s1")])).toBeUndefined()
  })

  it("does not read a SIBLING role's whole name as a use of this one (R78)", () => {
    // "Panda 2" is another role's whole name, and the rename has refused to
    // touch it since R75b. The export projection asks the same predicate with
    // the same guard, so the two cannot disagree: a bundle that carried "Panda"
    // here would ship a row for somebody the slice never mentions.
    const cast: Cast = {
      panda: { kind: "character", assetId: "char-panda", displayName: "Panda" },
      "panda-2": { kind: "character", assetId: "char-panda-2", displayName: "Panda 2" },
    }
    const shots = [
      shot("s1", {
        still: {
          nodeId: "generate-image-s1",
          url: "https://r2.example/s1.png",
          provider: "nano-banana",
          prompt: "Panda 2 waits by the door",
          results: [
            { url: "https://r2.example/s1.png", prompt: "Panda 2 waits by the door" },
          ],
        },
      }),
    ]
    expect(Object.keys(castForShots(cast, shots) ?? {})).toEqual(["panda-2"])
  })

  it("does not hit a longer word — 'Kira' must not match 'Kiralynn'", () => {
    const shots = [
      shot("s1", {
        still: {
          nodeId: "generate-image-s1",
          url: "https://r2.example/s1.png",
          provider: "nano-banana",
          prompt: "Kiralynn on the roof",
          results: [{ url: "https://r2.example/s1.png", prompt: "Kiralynn on the roof" }],
        },
      }),
    ]
    expect(castForShots(CAST, shots)).toBeUndefined()
  })
})

describe("the bundle carries the cast ONCE", () => {
  const named = shot("s1", {
    still: {
      nodeId: "generate-image-s1",
      url: "https://r2.example/s1.png",
      provider: "nano-banana",
      prompt: "Kira on the roof",
      results: [
        { url: "https://r2.example/s1.png", prompt: "Kira on the roof", references: [KIRA] },
      ],
    },
  })

  it("a film bundle carries it in `settings.studio`, once", () => {
    const bundle = buildBundle("film", source([named], CAST))
    expect(bundle.settings.studio.cast).toEqual({
      kira: { kind: "character", assetId: "char-kira", displayName: "Kira" },
    })
  })

  it("round-trips through the import reader unchanged", () => {
    const bundle = buildBundle("film", source([named], CAST))
    const reparsed = parseBundle(JSON.parse(JSON.stringify(bundle)))
    expect(reparsed.production.cast).toEqual(bundle.settings.studio.cast)
  })

  it("a scene bundle carries only that scene's roles", () => {
    const other = shot("s2", {
      still: {
        nodeId: "generate-image-s2",
        url: "https://r2.example/s2.png",
        provider: "nano-banana",
        prompt: "Jax in the rain",
        results: [{ url: "https://r2.example/s2.png", prompt: "Jax in the rain" }],
      },
    })
    const bundle = buildBundle("scene", source([named, other], CAST), {
      shotId: "s2",
    })
    expect(Object.keys(bundle.settings.studio.cast ?? {})).toEqual(["jax"])
  })

  it("a RECIPE-ONLY bundle carries no cast — a role is a binding", () => {
    const bundle = buildBundle("film", source([named], CAST), {
      includeMedia: false,
    })
    expect(bundle.settings.studio).not.toHaveProperty("cast")
  })

  it("…and says its roles by NAME, since it dropped the sheet that explains them", () => {
    // The promise the projection has always made ("those roles still arrive as
    // names in the prose"). Post-C6 the export has to DO it: a cast chip
    // serializes as `@kira`, and a recipe carrying that slug with no sheet is a
    // machine token nothing in the file can resolve.
    const tokened = shot("s1", {
      still: {
        nodeId: "generate-image-s1",
        url: "https://r2.example/s1.png",
        provider: "nano-banana",
        prompt: "@kira on the roof",
        results: [{ url: "https://r2.example/s1.png", prompt: "@kira on the roof" }],
      },
      plan: { motion: { prompt: "@kira turns away" } },
      beats: [{ id: "b1", seconds: 4, text: "@kira looks up" }],
    })
    for (const kind of ["film", "scene"] as const) {
      const entry = buildBundle(kind, source([tokened], CAST), {
        includeMedia: false,
      }).settings.studio.shots[0]!
      expect(entry.recipe?.framing?.prompt).toBe("Kira on the roof")
      expect(entry.plan?.motion?.prompt).toBe("Kira turns away")
      expect(entry.beats?.[0]?.text).toBe("Kira looks up")
    }
  })

  it("a LINKED bundle keeps the tokens — it ships the sheet that reads them", () => {
    const tokened = shot("s1", {
      still: {
        nodeId: "generate-image-s1",
        url: "https://r2.example/s1.png",
        provider: "nano-banana",
        prompt: "@kira on the roof",
        results: [
          { url: "https://r2.example/s1.png", prompt: "@kira on the roof", references: [KIRA] },
        ],
      },
    })
    const bundle = buildBundle("film", source([tokened], CAST))
    const parsed = parseBundle(JSON.parse(JSON.stringify(bundle)))
    expect(parsed.shots[0]!.still?.prompt).toBe("@kira on the roof")
    expect(Object.keys(bundle.settings.studio.cast ?? {})).toEqual(["kira"])
  })

  it("LEGACY: a cast-less production's bundle has no `cast` key at all", () => {
    const bundle = buildBundle("film", source([named]))
    expect(bundle.settings.studio).not.toHaveProperty("cast")
    expect(parseBundle(JSON.parse(JSON.stringify(bundle))).production).not.toHaveProperty(
      "cast",
    )
  })
})
