/**
 * Nodaro Image Upscale in the DAG lanes (`case "edit-image"` and
 * `case "upscale-image"`): the factor is always on the payload — the one the
 * worker renders, 2 for a missing or unknown one — and the payload's id is the
 * hold. The run's reservation then stores and measures the image and reserves
 * the output's tier (`stampNodaroImageUpscaleInput` / `nodaroImageUpscaleReserveId`,
 * lib/__tests__/nodaro-image-upscale-lane.test.ts); a stored `targetResolution`
 * never prices it. The model is a house model: served here by a fake plugin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { setPluginServices } from "../../../lib/private-plugins/services-registry.js"
import { buildPayload } from "../payload-builder.js"
import { nodaroImageUpscaleReserveId } from "../../../lib/nodaro-image-upscale-size.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const INPUTS: ResolvedInputs = { imageUrl: "https://cdn.example/source.png" }

beforeAll(() => {
  setPluginServices({
    houseModels: { ids: () => ["nodaro-image-upscale"], plan: () => ({ providerCostUsd: 0 }), start: async () => ({ taskRef: "r" }), poll: async () => ({ state: "running" }) },
  })
})
afterAll(() => {
  setPluginServices({})
})

function build(type: string, data: Record<string, unknown>) {
  const n: SimpleNode = { id: "n-1", type, data }
  return buildPayload(n, "job-1", INPUTS, undefined, { nodes: [n], edges: [], nodeStates: {} })
}

describe.each(["edit-image", "upscale-image"])("%s — Nodaro Image Upscale", (nodeType) => {
  it.each([
    [undefined, "2"],
    ["1", "1"],
    ["2", "2"],
    ["4", "4"],
    ["8", "8"],
    ["3", "2"],
  ])("upscaleFactor %s is sent as %s", (upscaleFactor, sent) => {
    const result = build(nodeType, { provider: "nodaro-image-upscale", upscaleFactor })
    expect(result.jobName).toBe("edit-image")
    expect(result.payload.provider).toBe("nodaro-image-upscale")
    expect(result.payload.upscaleFactor).toBe(sent)
    expect(result.payload.imageUrl).toBe(INPUTS.imageUrl)
  })

  it("the payload's id is the hold, whatever tier is stored; the reservation reads the stamp", () => {
    const result = build(nodeType, { provider: "nodaro-image-upscale", upscaleFactor: "4", targetResolution: "2K" })
    expect(result.modelIdentifier).toBe("nodaro-image-upscale")
    expect(nodaroImageUpscaleReserveId(result.jobName, result.payload)).toBe("nodaro-image-upscale")
    expect(nodaroImageUpscaleReserveId(result.jobName, { ...result.payload, nodaroImageUpscaleCreditId: "nodaro-image-upscale:4K" })).toBe("nodaro-image-upscale:4K")
  })

  it("Topaz renders a stale 8 at 2; Recraft keeps its own 4 as before, and is never sent an 8", () => {
    expect(build(nodeType, { provider: "topaz-image-upscale", upscaleFactor: "8" }).payload.upscaleFactor).toBe("2")
    const recraft = build(nodeType, { provider: "recraft-upscale", upscaleFactor: "4" })
    expect(recraft.modelIdentifier).toBe("recraft-upscale")
    expect(recraft.payload.upscaleFactor).toBe("4")
    expect(build(nodeType, { provider: "recraft-upscale", upscaleFactor: "8" }).payload.upscaleFactor).toBeUndefined()
  })
})
