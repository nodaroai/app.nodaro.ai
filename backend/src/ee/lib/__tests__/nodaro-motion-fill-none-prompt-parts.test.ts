/**
 * The fill "none" in the prompt-parts requests (cast-swap 0.432.0): a direct
 * run's setting whose Faces hidden fill is none asks the engine with
 * `maskFill: "none"`, so it lists and counts the `faceMeshFillNone` part (the
 * fill-none mesh line) in place of `faceMesh`'s. Sent only to an engine that
 * declares `castSwap.maskFillNone`; every other request is as before. The
 * answer's part ids take `faceMeshFillNone`.
 */
import { afterEach, describe, expect, it } from "vitest"
import { CAST_SWAP_PROMPT_PART_IDS } from "@nodaro/render-rules"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { forLoadedEngine, promptPartsAnswerSchema } from "../cast-swap-prompt-parts.js"
import { directRunRequest } from "../nodaro-motion-prompt-check.js"

const ENGINE = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["480p"], trendRun: true, promptParts: true, faceMesh: true }
const NONE_ENGINE = { ...ENGINE, maskFillNone: true, depthColormaps: ["grayscale", "turbo", "inferno", "magma", "viridis"] }
const NONE = { mode: "always", fill: "none", faceMesh: true } as const
const body = { hasAudio: true, roles: [] }

afterEach(() => _resetPluginSupportsForTests())

describe("a direct run's prompt-parts request, fill none", () => {
  it("says maskFill none (with the face mesh) to an engine that declares castSwap.maskFillNone: Precise's setting, Motion's own", () => {
    setPluginSupports({ castSwap: NONE_ENGINE } as never)
    const precise = forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, NONE))
    expect(precise).toMatchObject({ faceMesh: true, maskFill: "none" })
    expect(precise).not.toHaveProperty("depthColormap")
    expect(forLoadedEngine(directRunRequest("motion-pulse", "motion", { masking: NONE }, body))).toMatchObject({ faceMesh: true, maskFill: "none" })
    // A colormap left on the setting draws nothing under none: never sent.
    expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, { ...NONE, depthColormap: "inferno" }))).not.toHaveProperty("depthColormap")
  })

  it("never says it to an engine without castSwap.maskFillNone, nor for a masking off", () => {
    setPluginSupports({ castSwap: ENGINE } as never)
    const older = forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, NONE))
    expect(older).not.toHaveProperty("maskFill")
    expect(older).toMatchObject({ faceMesh: true })
    setPluginSupports({ castSwap: NONE_ENGINE } as never)
    expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, { ...NONE, mode: "off" }))).not.toHaveProperty("maskFill")
  })

  it("absent = before: a depth fill's request is unchanged by the declaration", () => {
    const depth = { mode: "always", fill: "depth", depthColormap: "viridis" } as const
    setPluginSupports({ castSwap: { ...NONE_ENGINE, maskFillNone: undefined } } as never)
    const before = forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, depth))
    setPluginSupports({ castSwap: NONE_ENGINE } as never)
    expect(forLoadedEngine(directRunRequest("motion-prism", "precise", undefined, body, depth))).toEqual(before)
    expect(before).toMatchObject({ depthColormap: "viridis", maskFill: "depth" })
  })
})

describe("the part ids", () => {
  it("faceMeshFillNone comes right after faceMesh, and an answer listing it parses", () => {
    const i = CAST_SWAP_PROMPT_PART_IDS.indexOf("faceMesh")
    expect(CAST_SWAP_PROMPT_PART_IDS[i + 1]).toBe("faceMeshFillNone")
    const part = { id: "faceMeshFillNone", default: "The thin gray face mesh lines …", defaultHash: "0123456789abcdef", placeholders: ["{video}"], required: [], applies: true }
    const answer = { set: "precise", parts: [part], assembled: "", length: 0, max: 4000, problems: [] }
    expect(promptPartsAnswerSchema.parse(answer).parts[0]!.id).toBe("faceMeshFillNone")
  })
})
