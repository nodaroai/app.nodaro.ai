import { describe, expect, it } from "vitest"
import { MODEL_CATALOG, listModels, type ModelMode } from "../model-catalog.js"
import { LIP_SYNC_PROVIDERS, SEEDANCE_LIP_SYNC_PROVIDERS, VIDEO_PROVIDERS_REQUIRING_IMAGE } from "../model-constants.js"
import { portraitVideoLipSyncModels } from "../driving-audio-lip-sync.js"

/**
 * The model list's lip-sync filter answers with every model the Lip Sync node
 * takes (decided 2026-11-24): the lip-sync mode's models, then the node's own
 * list. Every other filter, and every model's own `modes`, is unchanged.
 */
const EVERY_MODE: readonly ModelMode[] = [...new Set(Object.values(MODEL_CATALOG).flatMap((m) => m.modes))]
/** What every mode filter answered before: a model whose `modes` include it. */
const byOwnModes = (mode: ModelMode) => Object.values(MODEL_CATALOG).filter((m) => m.pickerHidden !== true && m.modes.includes(mode)).map((m) => m.id)

const ADDED = ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "seedance-2-5-flash", "minimax-h3", "ltx-2.5-fast"]

describe("listModels({ mode })", () => {
  it("every filter but lip-sync answers exactly what the models' own modes say", () => {
    for (const mode of EVERY_MODE.filter((m) => m !== "lip-sync")) {
      expect(listModels({ mode }).map((m) => m.id), mode).toEqual(byOwnModes(mode))
    }
  })

  it("lip-sync: the lip-sync mode's 11 models first, in today's order, then the node's own 7, in its order, each once", () => {
    const before = byOwnModes("lip-sync")
    expect(before).toHaveLength(11)
    const ids = listModels({ mode: "lip-sync" }).map((m) => m.id)
    expect(ids).toEqual([...before, ...ADDED])
    expect(new Set(ids).size).toBe(ids.length)
    // Every model the Lip Sync node takes is listed; nothing else is added.
    for (const id of LIP_SYNC_PROVIDERS) expect(ids, id).toContain(id)
  })

  it("lip-sync with a kind or family filter keeps that filter", () => {
    expect(listModels({ mode: "lip-sync", kind: "image" })).toEqual([])
    const fam = MODEL_CATALOG["ltx-2.5-fast"]!.family
    expect(listModels({ mode: "lip-sync", family: fam }).map((m) => m.id)).toEqual(["ltx-2.5-fast"])
  })

  it("the added models keep their own video modes: nothing derived from modes moves", () => {
    for (const id of ADDED) expect(MODEL_CATALOG[id]!.modes, id).not.toContain("lip-sync")
    expect([...VIDEO_PROVIDERS_REQUIRING_IMAGE].filter((id) => ADDED.includes(id))).toEqual([])
  })
})

describe("portraitVideoLipSyncModels", () => {
  it("is the Seedance lip-sync set and LTX 2.5 Fast, in the node's order", () => {
    expect(portraitVideoLipSyncModels()).toEqual(ADDED)
    for (const id of SEEDANCE_LIP_SYNC_PROVIDERS) expect(portraitVideoLipSyncModels()).toContain(id)
  })
})
