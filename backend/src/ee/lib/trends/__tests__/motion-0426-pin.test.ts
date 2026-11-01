/**
 * The no-change pin for the platform follow-ups of the Cast Swap engine
 * 0.426.0 (Prism's "one-tone" / "octave" reference audio, the gray fill
 * signal, the prompt-parts colormap): written and run FIRST, on the
 * untouched base, then kept green through the change. With nothing new
 * chosen (no new audio mode, no depth colormap, role outlines as they were),
 * every trend run body, every direct run's Prism reference audio and every
 * prompt-parts request is exactly what it was — whatever the engine
 * declares, the 0.426.0 capabilities included.
 */
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { prismReferenceAudioSent } from "../../../../lib/cast-swap-prism-reference-audio.js"
import type { FaceMaskingWithMarks } from "../../../../lib/cast-swap-face-masking.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { forLoadedEngine } from "../../cast-swap-prompt-parts.js"
import { directRunRequest } from "../../nodaro-motion-prompt-check.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskSettingsKey, storedFaceMaskFor } from "../face-mask.js"
import { promptPartsRequestFor } from "../prompt-parts-store.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import type { TrendFaceMask, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const SLOTS = [
  { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" },
  { key: "friend", kind: "person", label: { en: "Friend" }, required: false, roleName: "the man" },
] as TrendSlot[]
const box = { fromFrame: 0, toFrame: 10, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 60 }

/** The engine before 0.426.0 (role outlines, depth colormaps and Prism's per-resolution audio already in). */
const BASE_ENGINE = {
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
  sourceModes: ["faces", "full-depth", "keep-people"],
  faceMaskTargets: ["face", "head", "body"],
  faceMaskMarkLabels: ["erased", "main"],
  fullDepthScenes: ["description", "original", "none"],
  roleOutlines: true,
  prismReferenceAudio: true,
  prismReferenceAudioPerResolution: true,
  promptParts: true,
  promptStyles: ["precise", "precise-keep-people", "flexible"],
  faceMesh: true,
}
/** The engine at 0.426.0: every new declaration on. */
const ENGINE_0426 = {
  ...BASE_ENGINE,
  depthColormaps: ["grayscale", "turbo", "inferno", "magma", "viridis"],
  prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"],
}
const ENGINES = { base: BASE_ENGINE, "0.426.0": ENGINE_0426, none: undefined } as const

const MASKINGS = {
  plain: undefined,
  facesBlur: { mode: "always", threshold: 0.4 },
  facesDepth: { mode: "always", fill: "depth" },
  facesDepthOutlines: { mode: "always", fill: "depth", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  fullDepth: { mode: "always", source: "full-depth" },
} satisfies Record<string, FaceMaskingWithMarks | undefined>

function trend(faceMasking: FaceMaskingWithMarks | undefined, extra: Partial<TrendVersionData> = {}, outlines?: TrendFaceMask["outlines"]): TrendVersionData {
  const d0: TrendVersionData = {
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [SLOTS[0]!],
    references: [],
    examples: [{ videoUrl: "https://cdn.example/ex.mp4", width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: { lead: ["https://cdn.example/l.png"] } }],
    ...(faceMasking ? { faceMasking } : {}),
    ...extra,
  }
  if (!faceMasking) return d0
  const faceMask: TrendFaceMask = {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d0)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-11-01T10:00:00.000Z",
    approvedBy: "admin",
    ...(outlines ? { outlines } : {}),
  }
  const d = { ...d0, faceMask }
  expect(storedFaceMaskFor(d)).toBeTruthy()
  return d
}

function runBody(d: TrendVersionData, slots: Record<string, { images: string[] }> = { lead: { images: ["https://cdn.example/me.png"] } }) {
  const composed = composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots })
  withoutUnsupportedFields(composed)
  return composed.body as unknown as Record<string, unknown>
}

const ZONE = { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }
const STORED = { url: "https://cdn.example/trends/t1/clip.mp4", frames: 360 }

/** Pinned on the base (before the 0.426.0 follow-ups): the keys a run's body carries that these follow-ups touch. */
const PINNED_RUN: Record<string, Record<string, unknown>> = {
  plain: {},
  facesBlur: { faceMasking: { mode: "always", threshold: 0.4, zone: ZONE } },
  facesDepth: { faceMasking: { mode: "always", fill: "depth", zone: ZONE } },
  // Ringed: the lead's outline is named; the fill gray (the engine knows it from the outlines).
  facesDepthOutlines: {
    faceMasking: { mode: "always", fill: "depth", zone: ZONE },
    storedFaceMask: { ...STORED, required: true, outlines: [{ role: 1, colour: "#FF00FF" }] },
  },
  fullDepth: { faceMasking: { mode: "always", source: "full-depth", scene: "description" }, storedFaceMask: { ...STORED, required: true } },
}

const RINGED = [{ slot: "lead", colour: "#FF00FF", regionsDrawn: 12 }]

function picked(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of ["faceMasking", "storedFaceMask", "prismReferenceAudio"]) if (body[k] !== undefined) out[k] = body[k]
  return out
}

afterEach(() => _resetPluginSupportsForTests())

describe("pin: trend run bodies with nothing new chosen", () => {
  for (const [engineName, castSwap] of Object.entries(ENGINES)) {
    it(`are as before on the ${engineName} engine`, () => {
      if (!castSwap) return
      setPluginSupports({ castSwap } as never)
      for (const [name, m] of Object.entries(MASKINGS)) {
        const d = trend(m, {}, name === "facesDepthOutlines" ? RINGED : undefined)
        const body = runBody(d)
        const expected = { ...PINNED_RUN[name]! }
        // A stored mask is sent for faces only when required (here: under role outlines).
        if (name === "facesBlur" || name === "facesDepth") expected.storedFaceMask = { ...STORED }
        // The one difference by design, and only where role outlines are chosen: an engine that draws
        // depth colormaps (0.426.0) is told the stored clip's fill is GRAY (`storedFaceMask.depthColormap`).
        if (name === "facesDepthOutlines" && engineName === "0.426.0") {
          expected.storedFaceMask = { ...(expected.storedFaceMask as object), depthColormap: "grayscale" }
        }
        expect(picked(body), `${engineName} ${name}`).toEqual(expected)
      }
    })
  }

  it("a Prism trend's voice / none reference audio is sent as before", () => {
    for (const castSwap of [BASE_ENGINE, ENGINE_0426]) {
      setPluginSupports({ castSwap } as never)
      expect(picked(runBody(trend(undefined, { prismReferenceAudio: { "480p": "voice", "1080p": "none" } })))).toEqual({
        prismReferenceAudio: { "480p": "voice", "1080p": "none" },
      })
      expect(picked(runBody(trend(undefined, { prismReferenceAudio: "none" })))).toEqual({ prismReferenceAudio: { "480p": "none", "720p": "none", "1080p": "none" } })
      expect(picked(runBody(trend(undefined, { prismReferenceAudio: { "480p": "full" } })))).toEqual({})
    }
    // An engine that takes one mode only: the run's own resolution's (480p draft).
    setPluginSupports({ castSwap: { ...BASE_ENGINE, prismReferenceAudioPerResolution: false } } as never)
    expect(picked(runBody(trend(undefined, { prismReferenceAudio: { "480p": "voice" } })))).toEqual({ prismReferenceAudio: "voice" })
  })
})

describe("pin: a direct run's Prism reference audio with nothing new chosen", () => {
  it("is what it was, on every engine", () => {
    for (const castSwap of [BASE_ENGINE, ENGINE_0426]) {
      setPluginSupports({ castSwap } as never)
      expect(prismReferenceAudioSent({ resolution: "720p" }, { "720p": "voice" })).toEqual({ prismReferenceAudio: { "720p": "voice" } })
      expect(prismReferenceAudioSent({ draft: true }, { "480p": "none", "720p": "full" })).toEqual({ prismReferenceAudio: { "480p": "none" } })
      expect(prismReferenceAudioSent({}, { "480p": "full" })).toEqual({})
      expect(prismReferenceAudioSent({}, null)).toEqual({})
      expect(prismReferenceAudioSent({ engine: "kling-4" }, { "480p": "voice" })).toEqual({})
    }
    setPluginSupports({ castSwap: { ...BASE_ENGINE, prismReferenceAudioPerResolution: false } } as never)
    expect(prismReferenceAudioSent({ resolution: "1080p" }, { "1080p": "none" })).toEqual({ prismReferenceAudio: "none" })
  })
})

describe("pin: the prompt-parts request with nothing new chosen", () => {
  it("a trend's request is as before (no depthColormap, no maskFill), whatever the engine declares", () => {
    const pinned: Record<string, Record<string, unknown>> = {}
    for (const castSwap of [BASE_ENGINE, ENGINE_0426]) {
      setPluginSupports({ castSwap } as never)
      for (const [name, m] of Object.entries(MASKINGS)) {
        const asked = forLoadedEngine(promptPartsRequestFor(trend(m, {}, name === "facesDepthOutlines" ? RINGED : undefined)))
        // The one difference by design, and only where role outlines are chosen: an engine that draws depth
        // colormaps (0.426.0) is asked to word a ringed depth fill GRAY, as the run's prompt is.
        if (name === "facesDepthOutlines" && castSwap === ENGINE_0426) {
          expect(asked).toMatchObject({ depthColormap: "grayscale", maskFill: "depth" })
        } else {
          expect(asked, name).not.toHaveProperty("depthColormap")
          expect(asked, name).not.toHaveProperty("maskFill")
        }
        const { depthColormap: _c, maskFill: _f, roles: _roles, ...rest } = asked
        if (pinned[name]) expect(rest, name).toEqual(pinned[name])
        else pinned[name] = rest
      }
    }
    expect(pinned.facesDepthOutlines).toEqual({ engine: "seedance-2-5", source: "faces", promptStyle: "precise", roleOutlines: true, hasAudio: true, references: [] })
    expect(pinned.fullDepth).toEqual({ engine: "seedance-2-5", source: "full-depth", promptStyle: "flexible", scene: "description", hasAudio: true, references: [] })
    expect(pinned.plain).toEqual({ engine: "seedance-2-5", source: "faces", promptStyle: "precise", hasAudio: true, references: [] })
  })

  it("a direct run's request is as before", () => {
    for (const castSwap of [BASE_ENGINE, ENGINE_0426]) {
      setPluginSupports({ castSwap } as never)
      const body = { hasAudio: true, roles: [] }
      expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, { mode: "always", fill: "depth" }))).toEqual({
        engine: "seedance-2-5",
        style: "precise",
        promptStyle: "precise",
        source: "faces",
        hasAudio: true,
        roles: [],
      })
      expect(forLoadedEngine(directRunRequest("motion-pulse", "motion", { masking: { mode: "always", source: "full-depth" } }, body))).toMatchObject({
        engine: "kling-4",
        style: "motion",
        source: "full-depth",
      })
      expect(forLoadedEngine(directRunRequest("motion-pulse", "motion", { masking: { mode: "always", source: "full-depth" } }, body))).not.toHaveProperty("depthColormap")
    }
  })
})
