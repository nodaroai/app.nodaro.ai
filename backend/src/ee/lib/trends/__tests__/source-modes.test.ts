/**
 * A trend's clip source modes (`faceMasking.source`): `"faces"` (absent, today's
 * face mask), `"full-depth"` (the whole clip as one grayscale depth video) and
 * `"keep-people"` (the people kept as filmed, everything else depth, with
 * optional `"main"` marks). What must hold:
 *
 *  - every existing trend is unchanged: a `"faces"` setting keys, composes and
 *    publishes exactly as one with no `source`;
 *  - a mask stored under one mode reads as out of date under another, so it is
 *    never sent under the wrong mode and publishing is blocked;
 *  - the schema refuses what a mode cannot take, with a clear message;
 *  - a run sends what the mode uses, and always its stored clip;
 *  - publishing needs an engine that declares the mode.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { faceMaskingSchema, faceMaskingWithMarksSchema, faceMaskTargetOf, makeMarksOf } from "../../../../lib/cast-swap-face-masking.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun, TrendRunError } from "../compose.js"
import { faceMaskSettingsKey, faceMaskSettingsKeyOf, faceMaskState, reusableFaceMaskBase, storedFaceMaskFor } from "../face-mask.js"
import { faceMaskVariantsApply, markedPeople } from "../face-mask-variants.js"
import { publishBlockers } from "../publish-check.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendFaceMask, TrendVersionData, TrendPreviewClip } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
/**
 * A preview input clip current for the fixture's source at start 0, carrying
 * the matching cut of the data's current stored face mask when it has one:
 * publishing needs one (preview-clip.test.ts holds its rules).
 */
function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}
const MASKING = { mode: "always" as const, threshold: 0.4 }
const FULL = { mode: "always" as const, source: "full-depth" as const }
const KEEP = { mode: "always" as const, source: "keep-people" as const }
const box = { fromFrame: 0, toFrame: 359, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 90 }
const MAIN = { label: "main" as const, ...box }
const ERASED = { label: "erased" as const, ...box, leftPct: 60, rightPct: 90 }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return withClip({
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [
      { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" },
      { key: "guest", kind: "person", label: { en: "Guest" }, required: false, roleName: "the man" },
    ],
    references: [],
    examples: [],
    faceMasking: MASKING,
    ...over,
  })
}

/** `d` with a preview input clip current for it (its mask's cut when it has a current mask). */
const withClip = (d: TrendVersionData): TrendVersionData => ({ ...d, previewClip: previewClipFor(d) })

function mask(d: TrendVersionData, over: Partial<TrendFaceMask> = {}): TrendFaceMask {
  return {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-10-27T10:00:00.000Z",
    approvedBy: "admin",
    ...over,
  }
}

const ALL = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  faceMaskErase: true,
}
const DEPTH = {
  ...ALL,
  sourceModes: ["faces", "full-depth", "keep-people"],
  faceMaskTargets: ["face", "head", "body"],
  faceMaskMarkLabels: ["erased", "main"],
  // Full depth's default scene (a description) needs an engine that takes it (prompt-style.test.ts).
  fullDepthScenes: ["description", "original", "none"],
}
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-27T00:00:00Z",
})
const REQUIRED = ["staging", "production"]
const envs = (castSwap: Record<string, unknown>) => [env("staging", castSwap), env("production", castSwap)]

const trend = (d: TrendVersionData) => ({ id: "t-1", slug: "dance", version: 1, data: d })
const run = (d: TrendVersionData) => composeTrendRun(trend(d), { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof TrendRunError ? e.code : String(e)
  }
  return null
}
const issues = (faceMasking: unknown) => {
  const r = trendVersionDataSchema.safeParse(data({ faceMasking: faceMasking as never }))
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

describe("the settings key", () => {
  it("is byte for byte the same for `source: \"faces\"` as for no source", () => {
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, source: "faces" })).toBe(faceMaskSettingsKeyOf(SRC, MASKING))
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, source: "faces", target: "face", marks: [ERASED] }))
      .toBe(faceMaskSettingsKeyOf(SRC, { ...MASKING, target: "face", marks: [ERASED] }))
  })

  it("differs for each depth mode, and from faces", () => {
    const faces = faceMaskSettingsKeyOf(SRC, MASKING)
    const full = faceMaskSettingsKeyOf(SRC, FULL)
    const keep = faceMaskSettingsKeyOf(SRC, KEEP)
    expect(new Set([faces, full, keep]).size).toBe(3)
  })

  it("full depth: only the clip and the mode count (the face settings and marks do not apply)", () => {
    expect(faceMaskSettingsKeyOf(SRC, { ...FULL, threshold: 0.9, fill: "depth", zone: null, marks: [ERASED] })).toBe(faceMaskSettingsKeyOf(SRC, FULL))
  })

  it("keep people: the main marks count, and the fill does not; the target defaults to the whole person", () => {
    expect(faceMaskSettingsKeyOf(SRC, { ...KEEP, marks: [MAIN] })).not.toBe(faceMaskSettingsKeyOf(SRC, KEEP))
    expect(faceMaskSettingsKeyOf(SRC, { ...KEEP, fill: "depth" })).toBe(faceMaskSettingsKeyOf(SRC, KEEP))
    expect(faceMaskSettingsKeyOf(SRC, { ...KEEP, target: "body" })).toBe(faceMaskSettingsKeyOf(SRC, KEEP))
    expect(faceMaskSettingsKeyOf(SRC, { ...KEEP, target: "head" })).not.toBe(faceMaskSettingsKeyOf(SRC, KEEP))
    expect(faceMaskTargetOf(KEEP)).toBe("body")
    expect(faceMaskTargetOf(FULL)).toBeNull()
    expect(faceMaskTargetOf({ target: undefined })).toBe("head")
  })
})

describe("a mask approved under one mode, the setting then switched", () => {
  it("is out of date, never sent, and blocks publishing", () => {
    const approved = data()
    const switched = data({ faceMasking: FULL, faceMask: mask(approved) })
    expect(faceMaskState(switched, null, []).status).toBe("out_of_date")
    expect(storedFaceMaskFor(switched)).toBeUndefined()
    expect(codeOf(() => run(switched))).toBe("face_mask_required")
    const blockers = publishBlockers(switched, envs(DEPTH), REQUIRED)
    expect(blockers).toContainEqual(expect.objectContaining({ code: "face_mask_out_of_date", why: "settings" }))
  })

  it("from full depth back to faces too", () => {
    const approved = data({ faceMasking: FULL })
    const switched = data({ faceMasking: MASKING, faceMask: mask(approved) })
    expect(faceMaskState(switched, null, []).status).toBe("out_of_date")
    expect(storedFaceMaskFor(switched)).toBeUndefined()
  })
})

describe("the schema", () => {
  it("takes each depth mode with mode \"always\"", () => {
    expect(issues(FULL)).toEqual([])
    expect(issues(KEEP)).toEqual([])
    expect(issues({ ...KEEP, target: "body", marks: [MAIN, ERASED] })).toEqual([])
    expect(issues({ ...MASKING, source: "faces" })).toEqual([])
  })

  it("refuses a depth mode with mode \"auto\" or \"off\"", () => {
    for (const mode of ["auto", "off"]) {
      for (const source of ["full-depth", "keep-people"]) {
        const found = issues({ mode, source })
        expect(found.join("\n")).toMatch(/faceMasking\.mode: .*"always"/)
      }
    }
  })

  it("refuses the whole-person target and a main mark outside keep people", () => {
    expect(issues({ ...MASKING, target: "body" }).join("\n")).toMatch(/faceMasking\.target: /)
    expect(issues({ ...FULL, target: "body" }).join("\n")).toMatch(/faceMasking\.target: /)
    expect(issues({ ...MASKING, marks: [MAIN] }).join("\n")).toMatch(/faceMasking\.marks\.0\.label: /)
    expect(issues({ ...MASKING, source: "faces", marks: [MAIN] }).join("\n")).toMatch(/faceMasking\.marks\.0\.label: /)
    expect(faceMaskingWithMarksSchema.safeParse({ ...FULL, marks: [MAIN] }).success).toBe(false)
  })

  it("refuses an unknown source", () => {
    expect(issues({ mode: "always", source: "depth" })).not.toEqual([])
  })

  it("Nodaro Motion's direct-run setting takes faces only", () => {
    expect(faceMaskingSchema.safeParse(MASKING).success).toBe(true)
    expect(faceMaskingSchema.safeParse({ ...MASKING, source: "faces" }).success).toBe(true)
    expect(faceMaskingSchema.safeParse(FULL).success).toBe(false)
    expect(faceMaskingSchema.safeParse(KEEP).success).toBe(false)
    expect(faceMaskingSchema.safeParse({ ...MASKING, target: "body" }).success).toBe(false)
  })
})

describe("the marks a make applies", () => {
  it("faces: the erased ones; keep people: erased and main; full depth: none", () => {
    expect(makeMarksOf({ ...MASKING, marks: [ERASED, { label: { slot: "guest" }, ...box }] })).toEqual([ERASED])
    expect(makeMarksOf({ ...KEEP, marks: [MAIN, ERASED] })).toEqual([MAIN, ERASED])
    expect(makeMarksOf({ ...FULL, marks: [ERASED] })).toEqual([])
  })
})

describe("a run", () => {
  it("full depth sends the mode, the source and its scene (resolved) only, and its stored clip as required", () => {
    const d0 = data({ faceMasking: FULL })
    const { body, needs } = run({ ...d0, faceMask: mask(d0) })
    expect(body.faceMasking).toEqual({ mode: "always", source: "full-depth", scene: "description" })
    expect(body.promptStyle).toBe("flexible")
    expect(body.storedFaceMask).toEqual({ url: "https://cdn.example/trends/t1/clip.mp4", frames: 360, required: true })
    expect(needs.faceMaskSource).toBe("full-depth")
    expect(needs.faceMaskTarget).toBeNull()
    expect(needs.storedFaceMask).toBe(true)
  })

  it("keep people sends its source and resolved target, no fill and no marks, and its stored clip as required", () => {
    const d0 = data({ faceMasking: { ...KEEP, fill: "blur", marks: [MAIN] } })
    const { body, needs } = run({ ...d0, faceMask: mask(d0) })
    expect(body.faceMasking).toEqual({ mode: "always", source: "keep-people", target: "body", zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } })
    expect(body.storedFaceMask).toMatchObject({ required: true })
    expect(needs.faceMaskTarget).toBe("body")
  })

  it("a depth mode without its approved clip is refused (never masked per run)", () => {
    expect(codeOf(() => run(data({ faceMasking: FULL })))).toBe("face_mask_required")
    expect(codeOf(() => run(data({ faceMasking: KEEP })))).toBe("face_mask_required")
  })

  it("faces with `source: \"faces\"` composes exactly as with no source", () => {
    const plain = data()
    const named = data({ faceMasking: { ...MASKING, source: "faces" } })
    expect(run(named).body).toEqual(run(plain).body)
    expect(run(named).needs.faceMaskSource).toBe("faces")
  })

  it("person variants never apply to a depth mode (slot marks there do nothing)", () => {
    const slotMark = { label: { slot: "guest" }, ...box }
    const d0 = data({ faceMasking: { ...KEEP, marks: [slotMark] } })
    expect(markedPeople(d0)).toEqual([])
    expect(faceMaskVariantsApply(d0)).toBe(false)
    // The guest left empty: no variant asked for, the stored clip sent.
    expect(run({ ...d0, faceMask: mask(d0) }).body.storedFaceMask).toMatchObject({ required: true })
  })

  it("never reuses a raw face mask as the base of a depth clip", () => {
    const d0 = data({ faceMasking: KEEP })
    expect(reusableFaceMaskBase({ ...d0, faceMask: mask(d0, { rawMaskUrl: "https://cdn.example/raw.mp4", baseKey: faceMaskSettingsKey(d0)! }) }, "1")).toBeUndefined()
  })
})

describe("publishing", () => {
  const approved = (faceMasking: TrendVersionData["faceMasking"]) => {
    const d0 = data({ faceMasking })
    return withClip({ ...d0, faceMask: mask(d0) })
  }

  it("a depth mode on an engine without `sourceModes` is face_mask_source_unsupported", () => {
    for (const fm of [FULL, KEEP]) {
      const blockers = publishBlockers(approved(fm), envs(ALL), REQUIRED)
      expect(blockers.filter((b) => b.code === "face_mask_source_unsupported").map((b) => b.env)).toEqual(REQUIRED)
    }
    // An engine that lists modes, but not this one.
    const some = publishBlockers(approved(KEEP), envs({ ...DEPTH, sourceModes: ["faces", "full-depth"] }), REQUIRED)
    expect(some.some((b) => b.code === "face_mask_source_unsupported")).toBe(true)
  })

  it("faces (absent or named) never needs `sourceModes`", () => {
    expect(publishBlockers(approved(MASKING), envs(ALL), REQUIRED)).toEqual([])
    expect(publishBlockers(approved({ ...MASKING, source: "faces" }), envs(ALL), REQUIRED)).toEqual([])
  })

  it("a depth mode publishes on an engine that declares it", () => {
    expect(publishBlockers(approved(FULL), envs(DEPTH), REQUIRED)).toEqual([])
    expect(publishBlockers(approved({ ...KEEP, marks: [MAIN] }), envs(DEPTH), REQUIRED)).toEqual([])
  })

  it("keep people's whole-person target is a need of its own", () => {
    const blockers = publishBlockers(approved(KEEP), envs({ ...DEPTH, faceMaskTargets: ["face", "head"] }), REQUIRED)
    expect(blockers).toContainEqual({ code: "engine_unsupported", env: "staging", need: "faceMaskTarget:body" })
  })

  it("the person-variant gates are skipped for keep people", () => {
    const slotMark = { label: { slot: "guest" }, ...box }
    const blockers = publishBlockers(approved({ ...KEEP, marks: [slotMark] }), envs(DEPTH), REQUIRED)
    expect(blockers.filter((b) => b.code.startsWith("face_mask_variant") || b.code === "face_mask_people_over_cap")).toEqual([])
  })
})

describe("a full-depth clip's recipe", () => {
  it("has no Video Mask step: a stored clip with `core: null` is up to date; a face mask with it is not", () => {
    const full = data({ faceMasking: FULL })
    const fullState = faceMaskState({ ...full, faceMask: mask(full, { recipe: { core: null, plugin: "1" } }) }, envs(DEPTH), REQUIRED)
    expect(fullState).toEqual({ status: "approved", reasons: [] })
    // The engine's recipe still applies.
    expect(faceMaskState({ ...full, faceMask: mask(full, { recipe: { core: null, plugin: "0" } }) }, envs(DEPTH), REQUIRED).reasons)
      .toEqual([{ why: "plugin_recipe", env: "staging" }, { why: "plugin_recipe", env: "production" }])

    const faces = data()
    expect(faceMaskState({ ...faces, faceMask: mask(faces, { recipe: { core: null, plugin: "1" } }) }, envs(DEPTH), REQUIRED))
      .toEqual({ status: "out_of_date", reasons: [{ why: "core_recipe" }] })
    const keep = data({ faceMasking: KEEP })
    expect(faceMaskState({ ...keep, faceMask: mask(keep, { recipe: { core: null, plugin: "1" } }) }, envs(DEPTH), REQUIRED).reasons).toEqual([{ why: "core_recipe" }])
  })
})
