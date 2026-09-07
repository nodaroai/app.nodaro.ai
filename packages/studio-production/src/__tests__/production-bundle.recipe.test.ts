import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"

import type { Shot, ShotRecipeFraming } from "../shot"
import { buildBundle, type BundleSource } from "../bundle/production-bundle"
import { parseBundle } from "../bundle/production-bundle-parse"

/**
 * The RECIPE-ONLY half of the bundle builder's own test suite (B14) — split
 * out of `production-bundle.test.ts` pre-emptively (the file sat at 768
 * lines, under the 800-line house cap, but close enough that the program's
 * later tasks would push it over), the same "*.recipe.test.ts" precedent
 * `shot-graph.recipe.test.ts` already set: a standalone file with its own
 * local fixtures rather than an import from its sibling (importing a
 * `.test.ts` file would re-run its `describe`/`it` blocks a second time).
 * `SOURCE`/`richShot`/`stillOnly`/`REF`/`overTheWire` are exact duplicates of
 * the ones `production-bundle.test.ts`
 * still keeps for its own (non-recipe) suites — a pure move of the two
 * `describe` blocks that were entirely about recipe-only behaviour, with the
 * fixtures they need carried along rather than shared, so neither file depends
 * on the other's internals.
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

describe("buildBundle — recipe only (scene/film)", () => {
  it("a recipe-only film carries no URL and no references anywhere", () => {
    const bundle = buildBundle("film", SOURCE, { includeMedia: false })
    expect(bundle.nodaroStudio.media).toBe("none")

    const wire = JSON.stringify(bundle)
    expect(wire).not.toMatch(/https?:\/\//)
    expect(wire).not.toContain('"references"')

    const studio = bundle.settings.studio
    expect("music" in studio).toBe(false)
    expect("cuts" in studio).toBe(false)
    expect(bundle.nodes).toHaveLength(0)

    const entry = studio.shots[0]!
    expect(entry.imageNodeId).toBeUndefined()
    expect(entry.videoNodeId).toBeUndefined()
    expect(entry.recipe).toEqual({
      framing: {
        prompt: "hero on rooftop",
        provider: "seedream", // the ACTIVE result's model wins
        negativePrompt: "blurry",
        aspectRatio: "16:9",
        resolution: "2K",
      },
      directing: {
        prompt: "chase across the roof",
        provider: "seedance-2-5",
        duration: 8,
        negativePrompt: "slow",
        directions: [{ kind: "sfx", text: "footsteps" }],
      },
      voice: { text: "Stop right there!" },
    })
    // Beats survive minus their entity chips; look survives whole.
    expect(entry.beats?.[0]).toMatchObject({ id: "b1", text: "runs" })
    expect(entry.beats?.[0]?.references).toBeUndefined()
    expect(entry.look).toEqual({ lighting: "noir" })
  })

  it("a recipe carries the LOOK IDS of a format-2 result, and no catalog prose (G10)", () => {
    // A recipe has no urls and no references, so the ids are exactly what it is
    // FOR: regenerate from the same picks, but with today's catalog wording.
    const source = structuredClone(SOURCE) as typeof SOURCE
    const still = source.shots[0].still!
    const results = still.results as unknown as Array<Record<string, unknown>>
    results[still.activeIndex ?? 0].promptFormat = 2
    results[still.activeIndex ?? 0].look = { colorLookId: "warm" }
    const entry = buildBundle("film", source, { includeMedia: false }).settings
      .studio.shots[0]!
    expect(entry.recipe?.framing?.promptFormat).toBe(2)
    expect(entry.recipe?.framing?.look).toEqual({ colorLookId: "warm" })
  })

  it("a recipe carries the SUBJECT IDS of a format-2 result too, and reads them back (R48)", () => {
    // A subject is ids — not media, not a binding — so it belongs in a recipe
    // for exactly the reason the look ids do. Before R48 a recipe-only export
    // of a framed scene dropped who was in it while the linked export kept it.
    const source = structuredClone(SOURCE) as typeof SOURCE
    const still = source.shots[0].still!
    const results = still.results as unknown as Array<Record<string, unknown>>
    results[still.activeIndex ?? 0].promptFormat = 2
    results[still.activeIndex ?? 0].subject = { type: "woman", ethnicity: ["asian-any"] }
    const bundle = buildBundle("film", source, { includeMedia: false })
    expect(bundle.settings.studio.shots[0]!.recipe?.framing?.subject).toEqual({
      type: "woman",
      ethnicity: ["asian-any"],
    })
    // …and survives the wire: a field the reader drops is ERASED on the next save.
    expect(parseBundle(overTheWire(bundle)).shots[0]!.recipe?.framing?.subject).toEqual({
      type: "woman",
      ethnicity: ["asian-any"],
    })
  })

  it("a recipe from a LEGACY result carries no ids (its prompt already has them)", () => {
    // Gated on the ACTIVE result's OWN marker: ids beside a baked prompt would
    // state the same look twice on the regenerate.
    const entry = buildBundle("film", SOURCE, { includeMedia: false }).settings
      .studio.shots[0]!
    expect(entry.recipe?.framing).not.toHaveProperty("promptFormat")
    expect(entry.recipe?.framing).not.toHaveProperty("look")
  })

  it("every ShotRecipeFraming field survives the recipe-only wire (R48 guard)", () => {
    // A's guard, one level down: `Required<…>` so the NEXT recipe-level field
    // breaks compilation here until `framingRecipeOf` writes it and
    // `readRecipe` reads it back — the exact pair `subject` was missing from
    // (`promptFormat`/`look` had it; a serialize spread ERASES what the reader
    // drops, so half a wiring is worse than none).
    const framing: Required<ShotRecipeFraming> = {
      prompt: "hero on rooftop",
      provider: "nano-banana",
      negativePrompt: "blurry",
      aspectRatio: "16:9",
      resolution: "2K",
      promptFormat: 2,
      look: { colorLookId: "warm" },
      subject: { type: "woman" },
    }
    const source = structuredClone(SOURCE) as typeof SOURCE
    const still = source.shots[0].still!
    const results = still.results as unknown as Array<Record<string, unknown>>
    results[still.activeIndex ?? 0] = {
      ...results[still.activeIndex ?? 0],
      prompt: framing.prompt,
      provider: framing.provider,
      negativePrompt: framing.negativePrompt,
      aspectRatio: framing.aspectRatio,
      resolution: framing.resolution,
      promptFormat: framing.promptFormat,
      look: framing.look,
      subject: framing.subject,
    }
    const parsed = parseBundle(
      overTheWire(buildBundle("film", source, { includeMedia: false })),
    )
    expect(parsed.shots[0]!.recipe?.framing).toEqual(framing)
  })

  it("parses back as recipe shots (kind film, media none)", () => {
    const parsed = parseBundle(
      overTheWire(buildBundle("film", SOURCE, { includeMedia: false })),
    )
    expect(parsed.kind).toBe("film")
    expect(parsed.media).toBe("none")
    expect(parsed.shots[0]!.recipe?.framing?.prompt).toBe("hero on rooftop")
    expect(parsed.shots[0]!.still).toBeUndefined()
    expect(parsed.production).toEqual({
      folders: [{ id: "folder-1", name: "Act 1" }],
      storyboard: { brief: "a heist in one night" },
      film: { period: "80s" },
    })
  })
})

describe("buildBundle — recipe only carries the plan's voice (R38-7)", () => {
  it("survives untokenizeRecipeProse on a CAST-BEARING production (roleNames non-empty)", () => {
    // `untokenizeRecipeProse` only REBUILDS the plan literal when `roleNames`
    // is non-empty (a cast-less production returns the shot untouched, which
    // is exactly why this bug hid from the other recipe-only tests above —
    // none of them set `source.cast`).
    const shot: Shot = {
      id: "s3",
      plan: {
        frame: { prompt: "@kira on the rooftop" },
        voice: { text: "Stop right there!", casting: "male, urgent" },
      },
    }
    const source: BundleSource = {
      name: "Heist",
      shots: [shot],
      cast: { kira: { kind: "character", assetId: "char-1", displayName: "Kira" } },
    }
    const entry = buildBundle("film", source, { includeMedia: false }).settings
      .studio.shots[0]!
    expect(entry.plan?.voice).toEqual({
      text: "Stop right there!",
      casting: "male, urgent",
    })
    // `untokenizeRoles` spells the cast token back out as the display name —
    // the projection's own promise (`untokenizeRecipeProse`'s doc comment) —
    // so the frame prose is the NAME, not the token.
    expect(entry.plan?.frame?.prompt).toBe("Kira on the rooftop")
  })
})
