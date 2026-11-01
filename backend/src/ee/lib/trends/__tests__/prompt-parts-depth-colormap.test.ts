/**
 * The prompt-parts check asks the engine with the depth look (cast-swap
 * 0.426.0, `depthColormap` on `POST /v1/cast-swap/prompt-parts`): a trend or
 * a direct-run setting whose depth is drawn in another map than its source's
 * default says which, so the admin's previews and length checks word the
 * defaults by it. A Faces hidden depth fill says its fill too (`maskFill:
 * "depth"`: the engine reads a fill's look from it). Only to an engine that
 * lists the map in `castSwap.depthColormaps`; with nothing chosen, nothing
 * is added (motion-0426-pin.test.ts).
 */
import { afterEach, describe, expect, it } from "vitest"
import type { FaceMaskingWithMarks } from "../../../../lib/cast-swap-face-masking.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { forLoadedEngine } from "../../cast-swap-prompt-parts.js"
import { directRunRequest } from "../../nodaro-motion-prompt-check.js"
import { depthLookOf, promptPartsRequestFor } from "../prompt-parts-store.js"
import type { TrendVersionData } from "../types.js"

const ENGINE = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["480p"], trendRun: true, promptParts: true, roleOutlines: true }
const COLORMAPS = { ...ENGINE, depthColormaps: ["grayscale", "turbo", "inferno", "magma", "viridis"] }
const box = { fromFrame: 0, toFrame: 10, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 60 }

function trend(faceMasking: FaceMaskingWithMarks): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: "https://cdn.example/trends/t1/src.mp4",
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    faceMasking,
  }
}
const asked = (m: FaceMaskingWithMarks) => forLoadedEngine(promptPartsRequestFor(trend(m)))

afterEach(() => _resetPluginSupportsForTests())

describe("a trend's prompt-parts request", () => {
  it("names the chosen map: Full depth and Keep people alone, a depth fill with its fill", () => {
    setPluginSupports({ castSwap: COLORMAPS } as never)
    expect(asked({ mode: "always", source: "full-depth", depthColormap: "turbo" })).toMatchObject({ depthColormap: "turbo" })
    expect(asked({ mode: "always", source: "full-depth", depthColormap: "turbo" })).not.toHaveProperty("maskFill")
    expect(asked({ mode: "always", source: "keep-people", marks: [{ label: "main", ...box }], depthColormap: "magma" })).toMatchObject({ depthColormap: "magma" })
    expect(asked({ mode: "always", fill: "depth", depthColormap: "inferno" })).toMatchObject({ depthColormap: "inferno", maskFill: "depth" })
  })

  it("words a depth fill under role outlines gray, as its stored clip is drawn", () => {
    setPluginSupports({ castSwap: COLORMAPS } as never)
    const ringed = asked({ mode: "always", fill: "depth", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] })
    expect(ringed).toMatchObject({ roleOutlines: true, depthColormap: "grayscale", maskFill: "depth" })
  })

  it("adds nothing for the defaults, a blur fill, or masking off", () => {
    setPluginSupports({ castSwap: COLORMAPS } as never)
    for (const m of [
      { mode: "always", fill: "depth" },
      { mode: "always", fill: "depth", depthColormap: "turbo" },
      { mode: "always", depthColormap: "inferno" },
      { mode: "always", source: "full-depth", depthColormap: "grayscale" },
      { mode: "off", source: "full-depth", depthColormap: "inferno" },
      { mode: "always", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
    ] as FaceMaskingWithMarks[]) {
      expect(depthLookOf(m), JSON.stringify(m)).toEqual({})
      expect(asked(m), JSON.stringify(m)).not.toHaveProperty("depthColormap")
      expect(asked(m), JSON.stringify(m)).not.toHaveProperty("maskFill")
    }
  })

  it("is never sent to an engine that does not list the map (nor the fill beside it)", () => {
    for (const castSwap of [ENGINE, { ...ENGINE, depthColormaps: ["grayscale"] }]) {
      setPluginSupports({ castSwap } as never)
      const req = asked({ mode: "always", fill: "depth", depthColormap: "inferno" })
      expect(req).not.toHaveProperty("depthColormap")
      expect(req).not.toHaveProperty("maskFill")
    }
  })
})

describe("a direct run's prompt-parts request", () => {
  const body = { hasAudio: true, roles: [] }

  it("names the map its masking draws with: Precise's setting, Motion's own", () => {
    setPluginSupports({ castSwap: COLORMAPS } as never)
    expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, { mode: "always", fill: "depth", depthColormap: "viridis" }))).toMatchObject({
      depthColormap: "viridis",
      maskFill: "depth",
    })
    const flex = forLoadedEngine(directRunRequest("motion-pulse", "motion", { masking: { mode: "always", source: "full-depth", depthColormap: "inferno" } }, body))
    expect(flex).toMatchObject({ depthColormap: "inferno" })
    expect(flex).not.toHaveProperty("maskFill")
  })

  it("adds nothing for a default map, and nothing to an engine that does not list it", () => {
    setPluginSupports({ castSwap: COLORMAPS } as never)
    expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, { mode: "always", fill: "depth", depthColormap: "turbo" }))).not.toHaveProperty(
      "depthColormap",
    )
    setPluginSupports({ castSwap: ENGINE } as never)
    expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, { mode: "always", fill: "depth", depthColormap: "viridis" }))).not.toHaveProperty(
      "depthColormap",
    )
  })
})
