/**
 * The Flex prompt wording in the prompt-parts requests, and the answer read
 * tolerantly:
 *  - `promptWording` reaches the engine only when its `castSwap.promptWordings`
 *    lists the value, so an older engine is asked exactly as before;
 *  - a direct run's request says "new" only for a Flex (`motion`) run whose
 *    prompt style is Flexible — never for Precise, never for a Motion setting
 *    worded Precise; it names "current" on every other Flexible request (the
 *    engine lists the new wording's parts only when a request names one), and
 *    on a Precise one only when its overrides hold one of those parts;
 *  - an answer naming a part this app does not know (a newer engine's) still
 *    parses: the part is left out, a problem naming it stays a problem of the
 *    whole prompt.
 */
import { afterEach, describe, expect, it } from "vitest"
import { CAST_SWAP_PROMPT_PART_IDS } from "@nodaro/render-rules"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { forLoadedEngine, promptPartsAnswerSchema } from "../cast-swap-prompt-parts.js"
import { directRunRequest } from "../nodaro-motion-prompt-check.js"

const ENGINE = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["480p"], trendRun: true, promptParts: true, promptStyles: ["precise", "flexible"] }
const NEW_ENGINE = { ...ENGINE, promptWordings: ["current", "new"] }
const body = { hasAudio: true, roles: [] }

afterEach(() => _resetPluginSupportsForTests())

describe("a prompt-parts request's wording", () => {
  it("is sent only to an engine that lists the value", () => {
    setPluginSupports({ castSwap: NEW_ENGINE } as never)
    expect(forLoadedEngine({ engine: "seedance-2-5", promptWording: "new", ...body })).toMatchObject({ promptWording: "new" })
    expect(forLoadedEngine({ engine: "seedance-2-5", promptWording: "current", ...body })).toMatchObject({ promptWording: "current" })
    setPluginSupports({ castSwap: { ...ENGINE, promptWordings: ["current"] } } as never)
    expect(forLoadedEngine({ engine: "seedance-2-5", promptWording: "new", ...body })).not.toHaveProperty("promptWording")
    setPluginSupports({ castSwap: ENGINE } as never)
    for (const w of ["new", "current"] as const) {
      expect(forLoadedEngine({ engine: "seedance-2-5", promptWording: w, ...body })).toEqual(forLoadedEngine({ engine: "seedance-2-5", ...body }))
    }
  })
})

describe("a direct run's request", () => {
  it("says 'new' on a Flex run worded Flexible, 'current' on one left current", () => {
    setPluginSupports({ castSwap: NEW_ENGINE } as never)
    expect(forLoadedEngine(directRunRequest("motion-prism", "motion", undefined, body, undefined, undefined, "new"))).toMatchObject({
      style: "motion",
      promptStyle: "flexible",
      promptWording: "new",
    })
    expect(forLoadedEngine(directRunRequest("motion-pulse", "motion", { promptStyle: "flexible" }, body, undefined, undefined, "new"))).toMatchObject({
      promptWording: "new",
    })
    expect(directRunRequest("motion-prism", "motion", undefined, body, undefined, undefined, "current")).toMatchObject({ promptWording: "current" })
    expect(directRunRequest("motion-prism", "motion", undefined, body)).toMatchObject({ promptWording: "current" })
  })

  it("never says 'new' on Precise, nor on a Motion setting worded Precise: the request of before", () => {
    setPluginSupports({ castSwap: NEW_ENGINE } as never)
    const precise = directRunRequest("motion-prism", "precise", undefined, body, undefined, undefined, "new")
    expect(precise).not.toHaveProperty("promptWording")
    expect(precise).toEqual(directRunRequest("motion-prism", "precise", undefined, body))
    expect(directRunRequest("motion-prism", "motion", { promptStyle: "precise" }, body, undefined, undefined, "new")).not.toHaveProperty("promptWording")
  })

  it("names 'current' on a Precise request only when its overrides hold a part of the new wording (so it can be seen and reset)", () => {
    setPluginSupports({ castSwap: NEW_ENGINE } as never)
    expect(directRunRequest("motion-prism", "precise", undefined, { ...body, overrides: { motionLock: "x" } }, undefined, undefined, "new")).toMatchObject({
      promptWording: "current",
    })
    expect(directRunRequest("motion-prism", "precise", undefined, { ...body, overrides: { face: "x" } })).not.toHaveProperty("promptWording")
  })

  it("an engine without the wording is asked exactly as before", () => {
    setPluginSupports({ castSwap: ENGINE } as never)
    const { promptWording: _w, ...before } = directRunRequest("motion-prism", "motion", undefined, body)
    expect(forLoadedEngine(directRunRequest("motion-prism", "motion", undefined, body, undefined, undefined, "new"))).toEqual(forLoadedEngine(before))
  })
})

describe("the engine's answer", () => {
  const part = (id: string) => ({ id, default: "…", defaultHash: "0123456789abcdef", placeholders: ["{video}"], required: [], applies: true })

  it("the three new-wording parts are known ids, in the engine's order", () => {
    expect(CAST_SWAP_PROMPT_PART_IDS.indexOf("motionLock")).toBe(CAST_SWAP_PROMPT_PART_IDS.indexOf("opener") + 1)
    expect(CAST_SWAP_PROMPT_PART_IDS.indexOf("pictureRoles")).toBe(CAST_SWAP_PROMPT_PART_IDS.indexOf("location") + 1)
    expect(CAST_SWAP_PROMPT_PART_IDS.indexOf("restate")).toBe(CAST_SWAP_PROMPT_PART_IDS.indexOf("postHeader") - 1)
    const answer = { set: "flexible", parts: ["motionLock", "pictureRoles", "restate"].map(part), assembled: "", length: 0, max: 4000, problems: [] }
    expect(promptPartsAnswerSchema.parse(answer).parts.map((p) => p.id)).toEqual(["motionLock", "pictureRoles", "restate"])
  })

  it("leaves out a part this app does not know, and keeps a problem naming it as the whole prompt's", () => {
    const answer = {
      set: "flexible",
      parts: [part("opener"), part("aPartFromANewerEngine"), part("avoid")],
      assembled: "x",
      length: 1,
      max: 4000,
      problems: [
        { part: "aPartFromANewerEngine", code: "part_too_long", message: "Too long." },
        { part: "avoid", code: "part_too_long", message: "Too long too." },
      ],
    }
    const parsed = promptPartsAnswerSchema.parse(answer)
    expect(parsed.parts.map((p) => p.id)).toEqual(["opener", "avoid"])
    expect(parsed.problems).toEqual([
      { code: "part_too_long", message: "Too long." },
      { part: "avoid", code: "part_too_long", message: "Too long too." },
    ])
  })

  it("still refuses an answer off the contract", () => {
    expect(promptPartsAnswerSchema.safeParse({ set: "flexible", parts: [{ id: 3 }], assembled: "", length: 0, max: 1, problems: [] }).success).toBe(false)
    expect(promptPartsAnswerSchema.safeParse({ set: "nope", parts: [], assembled: "", length: 0, max: 1, problems: [] }).success).toBe(false)
  })
})
