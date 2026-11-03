/**
 * A stored clip drawn before the stray-face fix (decided 2026-11-03). The face
 * mesh recipe "2026-11-02" (the refined landmark model, before the fixes)
 * could draw a tiny or false face for a frame or two, which a Full depth run
 * renders as an object. A trend whose stored face mask records it is flagged
 * for the admin to make again (`faceMaskState`'s `flags`): a separate,
 * non-blocking kind. What must hold:
 *
 *  - exactly that recipe is flagged: the basic model's ("2026-10-31",
 *    "2026-11-01"), the fix's ("2026-11-03") and later ones, and none, are not;
 *  - the flag never makes the mask out of date: its status and reasons are
 *    what they are without it, so publishing, approving and runs (the stored
 *    clip still sent) go on exactly as before.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import type { FaceMaskingWithMarks } from "../../../../lib/cast-swap-face-masking.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun } from "../compose.js"
import { FACE_MESH_RECIPE_BEFORE_STRAY_FIX, faceMaskSettingsKey, faceMaskState, storedFaceMaskFor } from "../face-mask.js"
import { publishBlockers } from "../publish-check.js"
import type { TrendFaceMask, TrendPreviewClip, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const LEAD = { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" } as TrendSlot
const FULL_DEPTH_MESH: FaceMaskingWithMarks = { mode: "always", source: "full-depth", faceMesh: true }
const FACES_MESH: FaceMaskingWithMarks = { mode: "always", faceMesh: true }

const CS = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskRecipe: "1",
  sourceModes: ["faces", "full-depth", "keep-people"],
  fullDepthScenes: ["description", "original", "none"],
  faceMesh: true,
}
const env = (name: string): EngineEnvironment => ({ env: name, pluginBuildId: "b", supports: { castSwap: CS as never }, updatedAt: "2026-11-03T00:00:00Z" })
const ENVS = [env("staging"), env("production")]
const REQUIRED = ["staging", "production"]

/** A trend with an approved, up-to-date stored clip whose make drew the face mesh by `meshRecipe` (none: not recorded). */
function trend(faceMasking: FaceMaskingWithMarks, meshRecipe: string | undefined, over: Partial<TrendVersionData> = {}): TrendVersionData {
  const d0: TrendVersionData = {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [LEAD],
    references: [],
    examples: [{ videoUrl: "https://cdn.example/ex.mp4", width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: { lead: ["https://cdn.example/l.png"] } }],
    faceMasking,
  }
  const faceMask: TrendFaceMask = {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: faceMasking.source === "full-depth" ? null : VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d0)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-11-02T18:00:00.000Z",
    approvedBy: "admin",
    facesDrawn: 120,
    ...(meshRecipe ? { meshRecipe } : {}),
  }
  const d = { ...d0, faceMask }
  const previewClip: TrendPreviewClip = {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "2", madeAt: "2026-11-02T18:00:00.000Z",
    faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: faceMask.url },
  }
  return { ...d, previewClip, ...over }
}

const FLAG = [{ why: "face_mesh_before_stray_fix" }]

describe("which stored clips are flagged", () => {
  it("the recipe of the refined model before the fix, named in one place", () => {
    expect(FACE_MESH_RECIPE_BEFORE_STRAY_FIX).toBe("2026-11-02")
  })

  it("a stored clip drawn by it is flagged, and stays approved and up to date", () => {
    for (const masking of [FULL_DEPTH_MESH, FACES_MESH]) {
      const state = faceMaskState(trend(masking, "2026-11-02"), ENVS, REQUIRED)
      expect(state, JSON.stringify(masking)).toEqual({ status: "approved", reasons: [], flags: FLAG })
    }
  })

  it("the basic model's recipes, the fix's and later ones, and none, are not flagged", () => {
    for (const meshRecipe of ["2026-10-31", "2026-11-01", "2026-11-03", "2026-11-10", "2027-01-01", undefined]) {
      const state = faceMaskState(trend(FULL_DEPTH_MESH, meshRecipe), ENVS, REQUIRED)
      expect(state, String(meshRecipe)).toEqual({ status: "approved", reasons: [] })
      expect(Object.hasOwn(state, "flags"), String(meshRecipe)).toBe(false)
    }
  })

  it("beside the reasons of a mask out of date, which are what they are without it", () => {
    const changed = (meshRecipe: string) => ({ ...trend(FULL_DEPTH_MESH, meshRecipe), faceMasking: { ...FULL_DEPTH_MESH, depthModelSize: "small" as const } })
    const flagged = faceMaskState(changed("2026-11-02"), ENVS, REQUIRED)
    const unflagged = faceMaskState(changed("2026-11-03"), ENVS, REQUIRED)
    expect(unflagged).toEqual({ status: "out_of_date", reasons: [{ why: "settings" }] })
    expect(flagged).toEqual({ ...unflagged, flags: FLAG })
  })

  it("an engine recipe out of date stays a reason; the flag is still its own", () => {
    const older = [env("staging"), { ...env("production"), supports: { castSwap: { ...CS, faceMaskRecipe: "2" } as never } }]
    expect(faceMaskState(trend(FULL_DEPTH_MESH, "2026-11-02"), older, REQUIRED)).toEqual({
      status: "out_of_date",
      reasons: [{ why: "plugin_recipe", env: "production" }],
      flags: FLAG,
    })
  })

  it("no stored clip: nothing to flag", () => {
    const { faceMask: _none, ...d } = trend(FULL_DEPTH_MESH, "2026-11-02")
    expect(faceMaskState(d, ENVS, REQUIRED)).toEqual({ status: "none", reasons: [] })
  })
})

describe("the flag blocks nothing", () => {
  it("publishing: a flagged trend's blockers are exactly an unflagged one's", () => {
    for (const masking of [FULL_DEPTH_MESH, FACES_MESH]) {
      const flagged = publishBlockers(trend(masking, "2026-11-02"), ENVS, REQUIRED)
      expect(flagged, JSON.stringify(masking)).toEqual(publishBlockers(trend(masking, "2026-11-03"), ENVS, REQUIRED))
      expect(flagged.map((b) => b.code), JSON.stringify(masking)).not.toContain("face_mask_out_of_date")
      expect(flagged.map((b) => b.code), JSON.stringify(masking)).not.toContain("face_mask_missing")
    }
    // And the full-depth trend is publishable as it is.
    expect(publishBlockers(trend(FULL_DEPTH_MESH, "2026-11-02"), ENVS, REQUIRED)).toEqual([])
  })

  it("runs: the stored clip is still sent (a Full depth trend needs it: no face_mask_required)", () => {
    const d = trend(FULL_DEPTH_MESH, "2026-11-02")
    expect(storedFaceMaskFor(d)).toEqual({ url: "https://cdn.example/trends/t1/clip.mp4", frames: 360, facesDrawn: 120, meshRecipe: "2026-11-02" })
    const composed = composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
    expect(composed.body.storedFaceMask).toMatchObject({ url: "https://cdn.example/trends/t1/clip.mp4", required: true, meshRecipe: "2026-11-02" })
  })
})
