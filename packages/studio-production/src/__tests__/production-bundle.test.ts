import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"

import type { Shot } from "../shot"
import { clipResults, stillResults } from "../shot"
import {
  buildBundle,
  bundleFileName,
  type BundleSource,
  type ProductionBundle,
} from "../bundle/production-bundle"
import { parseBundle } from "../bundle/production-bundle-parse"
import { directionWireFields } from "../direction"

/**
 * The bundle builder — one envelope for frame / motion / scene / film
 * (portability spec §2). The load-bearing assertions:
 *   - sanitation by construction (no shared/trash/freecutDraftUrl/pendingClips),
 *   - frame/motion carry exactly the ACTIVE result,
 *   - recipe-only carries no URL, in every kind that offers it here,
 *   - a linked bundle round-trips through `parseBundle` (the import reader).
 * The full "NO URL and NO references anywhere" receipt for a recipe-only
 * export is pinned in the sibling `production-bundle.recipe.test.ts` (B14).
 */

const REF: ConnectedReference = {
  id: "char-1",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2.example/kira.png",
}

const richShot = (id: string): Shot => ({
  id,
  name: "Rooftop chase",
  folderId: "folder-1",
  still: {
    nodeId: `generate-image-${id}`,
    url: "https://r2.example/a2.png",
    provider: "nano-banana",
    prompt: "hero on rooftop",
    results: [
      { url: "https://r2.example/a1.png", prompt: "hero v1", provider: "nano-banana" },
      {
        url: "https://r2.example/a2.png",
        prompt: "hero on rooftop",
        provider: "seedream",
        negativePrompt: "blurry",
        aspectRatio: "16:9",
        resolution: "2K",
        referenceImageUrls: ["https://r2.example/ref.png"],
        references: [REF],
      },
    ],
    activeIndex: 1,
  },
  clip: {
    nodeId: `generate-video-${id}`,
    url: "https://r2.example/b2.mp4",
    provider: "grok-i2v",
    prompt: "chase across the roof",
    duration: 5,
    results: [
      {
        url: "https://r2.example/b1.mp4",
        prompt: "chase v1",
        provider: "grok-i2v",
        duration: 5,
        startFrameUrl: "https://r2.example/a1.png",
      },
      {
        url: "https://r2.example/b2.mp4",
        prompt: "chase across the roof",
        provider: "seedance-2-5",
        duration: 8,
        negativePrompt: "slow",
        directions: [{ kind: "sfx", text: "footsteps" }],
        startFrameUrl: "https://r2.example/a2.png",
      },
    ],
    activeIndex: 1,
  },
  voice: { url: "https://r2.example/v.mp3", text: "Stop right there!" },
  startFrame: "https://r2.example/a2.png",
  endFrame: "https://r2.example/end.png",
  directingReferenceUrls: ["https://r2.example/dr.png"],
  pendingClips: [
    { jobId: "job-9", provider: "grok-i2v", prompt: "p", startedAt: 1 },
  ],
  beats: [{ id: "b1", seconds: 4, text: "runs", references: [REF] }],
  look: { lighting: "noir" },
})

const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

const SOURCE: BundleSource = {
  name: "Heist",
  shots: [richShot("s1"), stillOnly("s2")],
  music: { url: "https://r2.example/music.mp3", prompt: "tense synth" },
  folders: [{ id: "folder-1", name: "Act 1" }],
  storyboard: { brief: "a heist in one night" },
  cuts: [
    {
      id: "cut-1",
      name: "Cut A",
      url: "https://r2.example/cut-a.mp4",
      exportedAt: "2026-08-30T00:00:00Z",
    },
  ],
  film: { period: "80s" },
}

/** A JSON wire round-trip — what a saved file actually contains. */
const overTheWire = (bundle: unknown): unknown =>
  JSON.parse(JSON.stringify(bundle))

describe("buildBundle — film (with media)", () => {
  it("bundles every shot + production extras, sanitized by construction", () => {
    const bundle = buildBundle("film", SOURCE)
    expect(bundle.version).toBe(1)
    expect(bundle.name).toBe("Heist")
    expect(bundle.nodaroStudio).toEqual({
      version: 1,
      app: "studio.nodaro.ai",
      kind: "film",
      media: "linked",
    })

    const studio = bundle.settings.studio
    expect("shared" in studio).toBe(false)
    expect("trash" in studio).toBe(false)
    expect("freecutDraftUrl" in studio).toBe(false)
    expect(studio.shots[0]!.pendingClips).toBeUndefined()
    // Film exports keep the folder structure.
    expect(studio.shots[0]!.folderId).toBe("folder-1")
    expect(studio.folders).toEqual([{ id: "folder-1", name: "Act 1" }])
    expect(studio.music?.url).toBe("https://r2.example/music.mp3")
    expect(studio.cuts).toHaveLength(1)
  })

  it("round-trips through parseBundle with histories, voice and keyframes intact", () => {
    const parsed = parseBundle(overTheWire(buildBundle("film", SOURCE)))
    expect(parsed.kind).toBe("film")
    expect(parsed.media).toBe("linked")
    expect(parsed.shots).toHaveLength(2)

    const s1 = parsed.shots[0]!
    expect(s1.name).toBe("Rooftop chase")
    expect(s1.still?.results).toHaveLength(2)
    expect(s1.still?.activeIndex).toBe(1)
    expect(s1.still?.url).toBe("https://r2.example/a2.png")
    expect(s1.clip?.results).toHaveLength(2)
    expect(s1.clip?.results?.[1]?.directions).toEqual([
      { kind: "sfx", text: "footsteps" },
    ])
    expect(s1.voice).toMatchObject({
      url: "https://r2.example/v.mp3",
      text: "Stop right there!",
    })
    expect(s1.startFrame).toBe("https://r2.example/a2.png")
    expect(s1.endFrame).toBe("https://r2.example/end.png")
    expect(s1.directingReferenceUrls).toEqual(["https://r2.example/dr.png"])
    expect(s1.pendingClips).toBeUndefined()

    expect(parsed.production.music?.prompt).toBe("tense synth")
    expect(parsed.production.folders).toHaveLength(1)
    expect(parsed.production.cuts).toHaveLength(1)
    expect(parsed.production.film).toEqual({ period: "80s" })
  })
})

// The recipe-only bundle behaviour ("buildBundle — recipe only (scene/film)"
// and "buildBundle — recipe only carries the plan's voice (R38-7)") lives in
// the sibling `production-bundle.recipe.test.ts` (B14, split out pre-emptively
// to stay ahead of the 800-line house cap) — same "*.recipe.test.ts" shape as
// `shot-graph.recipe.test.ts`.

describe("buildBundle — scene", () => {
  it("with media: the whole shot minus pendingClips and the dangling folderId", () => {
    const bundle = buildBundle("scene", SOURCE, { shotId: "s1" })
    expect(bundle.name).toBe("Heist — Rooftop chase")
    const entry = bundle.settings.studio.shots[0]!
    expect(bundle.settings.studio.shots).toHaveLength(1)
    expect(entry.folderId).toBeUndefined()
    expect(entry.pendingClips).toBeUndefined()
    expect(entry.voice?.url).toBe("https://r2.example/v.mp3")
    expect(parseBundle(overTheWire(bundle)).kind).toBe("scene")
  })

  it("recipe only: the shot collapses into its recipe", () => {
    const bundle = buildBundle("scene", SOURCE, {
      shotId: "s1",
      includeMedia: false,
    })
    expect(JSON.stringify(bundle)).not.toMatch(/https?:\/\//)
    expect(bundle.settings.studio.shots[0]!.recipe?.voice).toEqual({
      text: "Stop right there!",
    })
  })
})

describe("buildBundle — frame / motion (always with media)", () => {
  it("frame = exactly the ACTIVE still result", () => {
    const bundle = buildBundle("frame", SOURCE, { shotId: "s1" })
    expect(bundle.name).toBe("Heist — Rooftop chase — Ref 2")
    const parsed = parseBundle(overTheWire(bundle))
    expect(parsed.kind).toBe("frame")
    const shot = parsed.shots[0]!
    expect(shot.clip).toBeUndefined()
    expect(shot.voice).toBeUndefined()
    expect(shot.still?.url).toBe("https://r2.example/a2.png")
    expect(shot.still?.results ?? [{ url: shot.still!.url }]).toHaveLength(1)
    // The result keeps its restore context (prompt/model/levers/references).
    expect(shot.still?.results?.[0]).toMatchObject({
      prompt: "hero on rooftop",
      provider: "seedream",
      aspectRatio: "16:9",
    })
  })

  it("motion = exactly the ACTIVE take, with its source-frame context", () => {
    const bundle = buildBundle("motion", SOURCE, { shotId: "s1" })
    expect(bundle.name).toBe("Heist — Rooftop chase — Take 2")
    const parsed = parseBundle(overTheWire(bundle))
    expect(parsed.kind).toBe("motion")
    const shot = parsed.shots[0]!
    expect(shot.still).toBeUndefined()
    expect(shot.clip?.url).toBe("https://r2.example/b2.mp4")
    expect(shot.clip?.provider).toBe("seedance-2-5")
    const takes = shot.clip?.results ?? []
    expect(takes).toHaveLength(1)
    expect(takes[0]).toMatchObject({
      duration: 8,
      startFrameUrl: "https://r2.example/a2.png",
    })
  })

  it("frame/motion ignore includeMedia:false — a frame IS its media", () => {
    const bundle = buildBundle("frame", SOURCE, {
      shotId: "s1",
      includeMedia: false,
    })
    expect(bundle.nodaroStudio.media).toBe("linked")
  })

  it("throws when the scene lacks the artifact (UI gates should prevent this)", () => {
    const bare: BundleSource = { name: "X", shots: [{ id: "e1" }] }
    expect(() => buildBundle("frame", bare, { shotId: "e1" })).toThrow()
    expect(() => buildBundle("motion", bare, { shotId: "e1" })).toThrow()
    expect(() => buildBundle("scene", SOURCE, { shotId: "nope" })).toThrow()
  })
})

/**
 * The FILM LOOK on every kind (D-B1). Only the `film` bundle used to carry it,
 * so a scene imported elsewhere silently inherited the target's camera / colour
 * / style / period — the export had said nothing about the look it was made
 * under. Asserted per kind AND through `parseBundle`, because the emit and the
 * read-back are different modules.
 */
describe("buildBundle — every kind carries the production film look (D-B1)", () => {
  for (const kind of ["film", "scene", "frame", "motion"] as const) {
    it(`a ${kind} bundle emits it and parses it back`, () => {
      const bundle = buildBundle(kind, SOURCE, { shotId: "s1" })
      expect(bundle.settings.studio.film).toEqual({ period: "80s" })
      expect(parseBundle(overTheWire(bundle)).production.film).toEqual({
        period: "80s",
      })
    })
  }

  it("a recipe-only scene carries it too — a look is ids, not media", () => {
    const bundle = buildBundle("scene", SOURCE, {
      shotId: "s1",
      includeMedia: false,
    })
    expect(bundle.settings.studio.film).toEqual({ period: "80s" })
    // …and the recipe's no-URL promise is untouched: a look is ids.
    expect(JSON.stringify(bundle)).not.toMatch(/https?:\/\//)
  })

  it("a film-less production emits NO key (omit-when-empty)", () => {
    const bare: BundleSource = { ...SOURCE, film: {} }
    for (const kind of ["film", "scene", "frame", "motion"] as const) {
      const studio = buildBundle(kind, bare, { shotId: "s1" }).settings.studio
      expect("film" in studio).toBe(false)
    }
  })
})

// The LAYER SPLIT behind the selection (D-A1): `colorLookId` is a FILM key, the
// framing + atmosphere picks are the scene's own, and `LOOK` is their merge — so
// the fixture satisfies INV-A3 exactly as a real submit does.
const FILM_LOOK = { colorLookId: "kodak-vision3" }
const SCENE_LOOK = { framingId: "medium-shot", atmosphereId: ["fog"] }
const LOOK = { ...FILM_LOOK, ...SCENE_LOOK }
const IMAGE_FIELDS = directionWireFields(LOOK, "image")
const VIDEO_FIELDS = directionWireFields(LOOK, "video")

/** A shot whose ACTIVE still + clip were both made by the structured pipeline. */
const directed = (): Shot => ({
  id: "d1",
  still: {
    nodeId: "generate-image-d1",
    url: "https://r2.example/d1.png",
    provider: "nano-banana",
    prompt: "a knight on a hill",
    direction: IMAGE_FIELDS,
    results: [
      {
        url: "https://r2.example/d1.png",
        prompt: "a knight on a hill",
        provider: "nano-banana",
        promptFormat: 2,
        look: LOOK,
        filmLook: FILM_LOOK,
        sceneLook: SCENE_LOOK,
      },
    ],
    activeIndex: 0,
  },
  clip: {
    nodeId: "generate-video-d1",
    url: "https://r2.example/d1.mp4",
    provider: "seedance-2-5",
    prompt: "the knight turns",
    direction: VIDEO_FIELDS,
    results: [
      {
        url: "https://r2.example/d1.mp4",
        prompt: "the knight turns",
        provider: "seedance-2-5",
        promptFormat: 2,
        look: LOOK,
        filmLook: FILM_LOOK,
        sceneLook: SCENE_LOOK,
      },
    ],
    activeIndex: 0,
  },
})

const nodeOf = (bundle: ProductionBundle, type: string) =>
  bundle.nodes.find((n) => n.type === type) as
    | { data: Record<string, unknown> }
    | undefined

/**
 * The CINEMATIC channel on a frame / motion export.
 *
 * `frameBody` / `motionBody` rebuild the still/clip base FIELD-BY-FIELD (they
 * project ONE result), so unlike scene/film — which spread the whole shot
 * through `stripTransient` — they only carry what they explicitly read. They
 * once carried `prompt` and dropped `direction`, which shipped an exported
 * `generate-image` node holding raw unbaked prose with none of the ids that
 * produced it: a canvas re-run folded no cinematic clause at all. INV-D pins
 * the fix — direction rebases by EXACTLY the expression that rebases `prompt`.
 */
describe("buildBundle — frame/motion carry the cinematic ids (INV-D)", () => {
  it("a frame export emits the PLATFORM-keyed ids on its generate-image node", () => {
    const bundle = buildBundle("frame", { name: "P", shots: [directed()] })
    // Platform vocabulary, not studio picker keys — asserted against the ONE
    // conversion (`directionWireFields`), never a hardcoded key list.
    expect(nodeOf(bundle, "generate-image")!.data.direction).toEqual(IMAGE_FIELDS)
  })

  it("a motion export emits them on its generate-video node", () => {
    const bundle = buildBundle("motion", { name: "P", shots: [directed()] })
    expect(nodeOf(bundle, "generate-video")!.data.direction).toEqual(VIDEO_FIELDS)
  })

  it("matches what the equivalent scene export carries (no per-kind drift)", () => {
    const src: BundleSource = { name: "P", shots: [directed()] }
    const scene = buildBundle("scene", src)
    expect(nodeOf(buildBundle("frame", src), "generate-image")!.data.direction).toEqual(
      nodeOf(scene, "generate-image")!.data.direction,
    )
    expect(nodeOf(buildBundle("motion", src), "generate-video")!.data.direction).toEqual(
      nodeOf(scene, "generate-video")!.data.direction,
    )
  })

  it("a LEGACY active result exports NO direction, even beside a stamped base", () => {
    // The double-fold case: the still level still holds the ids a newer sibling
    // stamped, but the ACTIVE result's prompt is BAKED. Pairing that prompt with
    // live ids folds the same clause twice on the canvas.
    const shot = directed()
    const stale: Shot = {
      ...shot,
      still: {
        ...shot.still!,
        results: [{ url: "https://r2.example/legacy.png", prompt: "baked prose, foggy" }],
        activeIndex: 0,
      },
    }
    const node = nodeOf(buildBundle("frame", { name: "P", shots: [stale] }), "generate-image")!
    expect("direction" in node.data).toBe(false)
  })

  it("a PROMPTLESS take inherits the clip's ids (the re-voice-chain shape)", () => {
    // `prompt` falls back to the clip level here, so its direction must too.
    const shot = directed()
    const revoiced: Shot = {
      ...shot,
      clip: {
        ...shot.clip!,
        results: [{ url: "https://r2.example/revoiced.mp4", provider: "seedance-2-5" }],
        activeIndex: 0,
      },
    }
    const node = nodeOf(buildBundle("motion", { name: "P", shots: [revoiced] }), "generate-video")!
    expect(node.data.direction).toEqual(VIDEO_FIELDS)
  })

  it("a channel-less shot exports NO key (byte-identity holds)", () => {
    const bundle = buildBundle("frame", { name: "P", shots: [stillOnly("s9")] })
    // All THREE channels `carryDirection` / `resultDirection` can emit — the
    // omit-when-empty half. Assert each by its LIVE name: a stale spelling here
    // is a guard that can never fail (`"structured" in data` stayed false for
    // the whole of S6/S7 purely because the key had been renamed away).
    expect("direction" in nodeOf(bundle, "generate-image")!.data).toBe(false)
    expect("subject" in nodeOf(bundle, "generate-image")!.data).toBe(false)
    expect("structured" in nodeOf(bundle, "generate-image")!.data).toBe(false)
  })

  /**
   * The POSITIVE half, which is what makes the three absence assertions above
   * mean something: each channel must actually reach the exported node data.
   * `subject` rides the same INV-D gate as `direction` (studio-written, cleared
   * by an unmarked result); `structured` is the canvas's own passthrough, which
   * a bundle carries for the same reason a save does — an export that drops it
   * is one more way to erase a field studio does not own.
   */
  it("carries the SUBJECT ids and the canvas `structured` passthrough too", () => {
    const subject = { age: "age-30s", ethnicity: ["eth-a", "eth-b"] }
    const structured = { person: { age: 34, hair: "auburn bob" }, mood: "wistful" }
    const base = directed()
    const shot: Shot = {
      ...base,
      // Both levels, exactly as `directed()` sets `direction` on the base and
      // `look` on the result: frame/motion re-project the RESULT, scene/film
      // spread the BASE, and the no-drift assertion below compares the two.
      still: {
        ...base.still!,
        subject,
        structured,
        results: [{ ...base.still!.results![0]!, subject }],
      },
      clip: {
        ...base.clip!,
        subject,
        structured,
        results: [{ ...base.clip!.results![0]!, subject }],
      },
    }
    const src: BundleSource = { name: "P", shots: [shot] }
    const frame = nodeOf(buildBundle("frame", src), "generate-image")!
    expect(frame.data.subject).toEqual(subject)
    expect(frame.data.structured).toEqual(structured)
    const motion = nodeOf(buildBundle("motion", src), "generate-video")!
    expect(motion.data.subject).toEqual(subject)
    expect(motion.data.structured).toEqual(structured)
    // …and no per-kind drift, exactly as `direction` is pinned above.
    expect(nodeOf(buildBundle("scene", src), "generate-image")!.data.subject).toEqual(
      frame.data.subject,
    )
  })

  it("never aliases the source shot (copy-on-write)", () => {
    const shot = directed()
    const bundle = buildBundle("frame", { name: "P", shots: [shot] })
    expect(nodeOf(bundle, "generate-image")!.data.direction).not.toBe(shot.still!.direction)
  })
})

/**
 * The FULL-BUNDLE round-trip of a `promptFormat: 2` result (D4), all four kinds.
 *
 * Two suites already pin two thirds of the marker's life: the STORE half
 * (`buildStill`/`buildClip`'s lone-result collapse) and the GRAPH half
 * (`serializeProduction` → `parseProduction`) live in
 * `src/lib/__tests__/prompt-format-roundtrip.test.ts`; the INV-D block above
 * pins the NODE's `direction`. Neither covers the ENVELOPE — and the bundle
 * path is written by DIFFERENT projections (`frameBody`/`motionBody` rebuild
 * field-by-field; `stripTransient` / `toRecipeOnlyShot` for scene/film) and read
 * by a DIFFERENT reader (`parseBundle`), so the marker can go missing on a path
 * both other suites call green.
 *
 * **Failure shape.** Lose `promptFormat` anywhere along export → import and the
 * restored result reads as LEGACY: D4's per-stage suppression re-arms, the Look
 * pickers gag on a brand-new-looking result, and `look` is dead weight beside a
 * prompt that never had the clauses baked in. Lose `look` instead and the wire
 * silently loses the ids that produced the media. Either way it is the exact
 * bug class D4 exists to kill, entering through the side door.
 *
 * (The cross-account variant — a re-pointed `references[].id` must still count
 * as a new-format seed — is added when the bundle entity-assets work ships.)
 */
describe("bundle envelope — a format-2 result survives export → import (D4)", () => {
  const src = (): BundleSource => ({ name: "P", shots: [directed()] })

  const activeStillOf = (shot: Shot) =>
    stillResults(shot.still!)[shot.still!.activeIndex ?? 0]!
  const activeClipOf = (shot: Shot) =>
    clipResults(shot.clip!)[shot.clip!.activeIndex ?? 0]!

  for (const kind of ["film", "scene", "frame"] as const) {
    it(`a ${kind} bundle restores the still's marker, ids and wire`, () => {
      const bundle = buildBundle(kind, src())
      const restored = activeStillOf(parseBundle(overTheWire(bundle)).shots[0]!)
      // The D4 legacy gate keys off the marker's PRESENCE — absent means "the
      // prompt has the catalog clauses baked in", which this prose does not.
      expect(restored.promptFormat).toBe(2)
      expect(restored.look).toEqual(LOOK)
      // …and WHICH SURFACE each of those ids came from (D-A1). They ride every
      // bundle kind for free (`frameBody`/`motionBody` pass the result verbatim
      // into `buildStill`/`buildClip`), which is exactly why a keep-predicate or
      // reader that forgets them would go unnoticed until a restore lied.
      expect(restored.filmLook).toEqual(FILM_LOOK)
      expect(restored.sceneLook).toEqual(SCENE_LOOK)
      expect({ ...restored.filmLook, ...restored.sceneLook }).toEqual(restored.look)
      // …and the ids still reproduce the wire the run went out with (D2c).
      expect(directionWireFields(restored.look!, "image")).toEqual(IMAGE_FIELDS)
      expect(directionWireFields(restored.look!, "image")).toEqual(
        nodeOf(bundle, "generate-image")!.data.direction,
      )
    })
  }

  for (const kind of ["film", "scene", "motion"] as const) {
    it(`a ${kind} bundle restores the take's marker, ids and wire`, () => {
      const bundle = buildBundle(kind, src())
      const restored = activeClipOf(parseBundle(overTheWire(bundle)).shots[0]!)
      expect(restored.promptFormat).toBe(2)
      expect(restored.look).toEqual(LOOK)
      // The take's layer split rides every kind too (D-A1).
      expect(restored.filmLook).toEqual(FILM_LOOK)
      expect(restored.sceneLook).toEqual(SCENE_LOOK)
      expect({ ...restored.filmLook, ...restored.sceneLook }).toEqual(restored.look)
      expect(directionWireFields(restored.look!, "video")).toEqual(VIDEO_FIELDS)
      expect(directionWireFields(restored.look!, "video")).toEqual(
        nodeOf(bundle, "generate-video")!.data.direction,
      )
    })
  }

  it("a recipe-only bundle round-trips the marker on both halves", () => {
    // A recipe carries `look` + `promptFormat` and NO urls (D4c) — it is read
    // back by `readRecipe`, a third reader again, and seeds the composer
    // directly. The same marker loss would re-arm suppression on a paste.
    const recipe = parseBundle(
      overTheWire(buildBundle("film", src(), { includeMedia: false })),
    ).shots[0]!.recipe
    expect(recipe?.framing?.promptFormat).toBe(2)
    expect(recipe?.framing?.look).toEqual(LOOK)
    expect(recipe?.directing?.promptFormat).toBe(2)
    expect(recipe?.directing?.look).toEqual(LOOK)
  })

  it("a LEGACY active result round-trips with NO marker (the other direction)", () => {
    // Degrading toward legacy is safe; laundering legacy into format 2 is the
    // failure. Pin both edges so a "helpful" default can't stamp the marker on.
    const shot = directed()
    const legacy: Shot = {
      ...shot,
      still: {
        ...shot.still!,
        results: [{ url: "https://r2.example/legacy.png", prompt: "baked prose, foggy" }],
        activeIndex: 0,
      },
    }
    const restored = activeStillOf(
      parseBundle(overTheWire(buildBundle("frame", { name: "P", shots: [legacy] })))
        .shots[0]!,
    )
    expect(restored).not.toHaveProperty("promptFormat")
    expect(restored).not.toHaveProperty("look")
    // …and no layer split either: BOTH absent means "merged-only", and claiming
    // an empty film layer here would make a restore CLEAR the target's film.
    expect(restored).not.toHaveProperty("filmLook")
    expect(restored).not.toHaveProperty("sceneLook")
  })
})

describe("bundleFileName", () => {
  it("derives <safe name>.<kind>.json with the shared sanitizer", () => {
    const bundle = buildBundle("film", {
      ...SOURCE,
      name: 'AC/DC: "Live"',
    })
    const file = bundleFileName(bundle)
    expect(file.endsWith(".film.json")).toBe(true)
    expect(file).not.toMatch(/[\\/:*?"<>|]/)
  })

  it("falls back to `production` for an all-hostile name", () => {
    const bundle = buildBundle("film", { ...SOURCE, name: "///" })
    expect(bundleFileName(bundle)).toBe("production.film.json")
  })
})
