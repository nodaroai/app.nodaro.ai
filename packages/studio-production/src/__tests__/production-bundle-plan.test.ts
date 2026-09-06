import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"

import type { Shot } from "../shot"
import type { ScenePlan } from "../scene-plan"
import { planWithoutMedia } from "../scene-plan"
import { buildBundle, type BundleSource } from "../bundle/production-bundle"
import { parseBundle } from "../bundle/production-bundle-parse"

/**
 * A "RECIPE ONLY" BUNDLE CARRIES THE PLAN — the open interaction the
 * structured-prompt-assembly design left for this suite to close.
 *
 * `toRecipeOnlyShot` rebuilds a shot field-by-field and used to drop
 * `shot.plan`, while the linked-media path (`stripTransient`) spreads and kept
 * it. Before the plan format that cost nothing — an unrendered scene had no
 * durable prompt to lose. After it, importing a plan-only production and
 * re-exporting it recipe-only silently dropped every authored prompt and lever,
 * and the SAME export with linked media kept them.
 *
 * THE DECISION: authored intent IS part of a recipe (both are prose + levers),
 * and the invariant survives by SUBTRACTION — a plan's only url-bearing fields
 * are `frame.references`, `frame.referenceImageUrls` and `motion.references`,
 * and `planWithoutMedia` removes exactly those. What is left has no url in it,
 * which the whole-JSON guard below states rather than assumes.
 */

const REF: ConnectedReference = {
  id: "char-1",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2.example/kira.png",
}

const PLAN: ScenePlan = {
  frame: {
    prompt: "@kira on the rooftop at dusk",
    promptBaked: true,
    provider: "seedream",
    aspectRatio: "16:9",
    resolution: "2K",
    count: 4,
    negativePrompt: "blurry",
    references: [REF],
    referenceImageUrls: ["https://r2.example/mood.png"],
  },
  motion: {
    prompt: "she turns and walks out of frame",
    provider: "seedance-2-5",
    duration: 8,
    cameraMotionId: "dolly-in",
    references: [REF],
  },
}

/** An IMPORTED, unrendered scene: a plan, and nothing rendered yet. */
const planOnlyShot: Shot = { id: "s1", name: "Rooftop", plan: PLAN }

const SOURCE: BundleSource = { name: "Heist", shots: [planOnlyShot] }

const overTheWire = (bundle: unknown): unknown => JSON.parse(JSON.stringify(bundle))

describe("planWithoutMedia", () => {
  it("keeps the prose and every lever, drops the three media fields", () => {
    expect(planWithoutMedia(PLAN)).toEqual({
      frame: {
        prompt: "@kira on the rooftop at dusk",
        promptBaked: true,
        provider: "seedream",
        aspectRatio: "16:9",
        resolution: "2K",
        count: 4,
        negativePrompt: "blurry",
      },
      motion: {
        prompt: "she turns and walks out of frame",
        provider: "seedance-2-5",
        duration: 8,
        cameraMotionId: "dolly-in",
      },
    })
  })

  it("cascades omit-when-empty: a media-ONLY stage, then the whole plan, drop", () => {
    expect(planWithoutMedia({ frame: { references: [REF] } })).toBeUndefined()
    expect(
      planWithoutMedia({ frame: { references: [REF] }, motion: { prompt: "pan" } }),
    ).toEqual({ motion: { prompt: "pan" } })
    expect(planWithoutMedia(undefined)).toBeUndefined()
  })

  it("never mutates the plan it was handed", () => {
    const before = structuredClone(PLAN)
    planWithoutMedia(PLAN)
    expect(PLAN).toEqual(before)
  })

  it("keeps voice whole — no url-bearing field to subtract (D4)", () => {
    const voice = { text: "Go now", casting: "male, urgent" }
    expect(planWithoutMedia({ ...PLAN, voice })).toEqual({
      ...planWithoutMedia(PLAN),
      voice,
    })
    // A voice-only plan (no frame/motion) still survives whole.
    expect(planWithoutMedia({ voice })).toEqual({ voice })
  })
})

describe("recipe-only export — the authored plan survives", () => {
  it("carries every plan prompt and lever an imported scene was authored with", () => {
    const entry = buildBundle("film", SOURCE, { includeMedia: false }).settings
      .studio.shots[0]!
    expect(entry.plan).toEqual(planWithoutMedia(PLAN))
    expect(entry.plan?.frame?.prompt).toBe("@kira on the rooftop at dusk")
    expect(entry.plan?.motion?.prompt).toBe("she turns and walks out of frame")
  })

  it("strips the plan's references and reference images, like everything else", () => {
    const bundle = buildBundle("film", SOURCE, { includeMedia: false })
    const wire = JSON.stringify(bundle)
    // The recipe invariant, stated over the WHOLE file: no url, no references,
    // wherever they might have hidden.
    expect(wire).not.toMatch(/https?:\/\//)
    expect(wire).not.toContain('"references"')
    expect(wire).not.toContain('"referenceImageUrls"')
  })

  it("round-trips: import a plan-only production, export recipe-only, re-import", () => {
    const parsed = parseBundle(
      overTheWire(buildBundle("film", SOURCE, { includeMedia: false })),
    )
    expect(parsed.media).toBe("none")
    expect(parsed.shots[0]!.plan).toEqual(planWithoutMedia(PLAN))
    // …and it is still the node-less placeholder a recipe shot has to be.
    expect(parsed.shots[0]!.still).toBeUndefined()
    expect(parsed.shots[0]!.clip).toBeUndefined()
  })

  it("a scene export carries it too — the projection is one function", () => {
    const entry = buildBundle("scene", SOURCE, {
      shotId: "s1",
      includeMedia: false,
    }).settings.studio.shots[0]!
    expect(entry.plan?.frame?.provider).toBe("seedream")
  })

  it("a plan-LESS shot exports byte-identically to before the carry existed", () => {
    // Omit-when-empty: no `plan` key at all, so a production that never
    // authored one is untouched by this.
    const entry = buildBundle("film", { name: "X", shots: [{ id: "s1" }] }, {
      includeMedia: false,
    }).settings.studio.shots[0]!
    expect("plan" in entry).toBe(false)
  })

  it("carries the scene's generic prompt — same portability profile as the shots", () => {
    // Prose with no url in it, which is what a recipe is made of. Left out, an
    // unrendered scene exported recipe-only lost the paragraph it was authored
    // with while the same export with LINKED media kept it.
    const entry = buildBundle(
      "film",
      { name: "Heist", shots: [{ ...planOnlyShot, scenePrompt: "A rooftop chase." }] },
      { includeMedia: false },
    ).settings.studio.shots[0]!
    expect(entry.scenePrompt).toBe("A rooftop chase.")
  })

  it("carries the scene's END transition — a recipe's kind of decision", () => {
    // A catalog id and three lever ids: no url, no binding. The recipe-only
    // projection builds its shot from an ALLOWLIST, so a scene field left off
    // it is dropped from every recipe-only export.
    const entry = buildBundle(
      "film",
      {
        name: "Heist",
        shots: [{ ...planOnlyShot, endTransition: { id: "fade-to-black", duration: "long" } }],
      },
      { includeMedia: false },
    ).settings.studio.shots[0]!
    expect(entry.endTransition).toEqual({ id: "fade-to-black", duration: "long" })
  })

  it("spells a role TOKEN back out in the scene prompt, like every other recipe prose field", () => {
    const entry = buildBundle(
      "film",
      {
        name: "Heist",
        shots: [{ id: "s1", scenePrompt: "the whole clip follows @kira" }],
        cast: {
          kira: { kind: "character", assetId: "char-1", displayName: "Kira" },
        },
      },
      { includeMedia: false },
    ).settings.studio.shots[0]!
    expect(entry.scenePrompt).toBe("the whole clip follows Kira")
  })

  it("a LINKED export still keeps the plan whole, references and all", () => {
    // The two paths differ only in what a recipe may carry — the linked one has
    // no reason to strip anything.
    const entry = buildBundle("film", SOURCE).settings.studio.shots[0]!
    expect(entry.plan?.frame?.references?.[0]?.id).toBe("char-1")
  })
})
