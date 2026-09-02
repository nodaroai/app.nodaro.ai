/**
 * Topaz image upscale in the DAG lanes — the reserved tier is the rendered tier.
 *
 * `topaz/image-upscale` has exactly ONE quality lever (`upscale_factor`:
 * 1 / 2 / 4). The `targetResolution` both lanes used to price on has no
 * provider parameter behind it, so a workflow node could reserve the 4K/8K
 * tier and render a 2x image (or reserve the base tier and render 4x).
 * `resolveTopazUpscale` is the single authority; these pins assert both
 * payload-builder branches — `case "edit-image"` and `case "upscale-image"` —
 * emit an identifier and an `upscaleFactor` that agree with it, and that a
 * non-Topaz provider is untouched.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { resolveTopazUpscale, buildCreditModelIdentifier } from "@nodaro/shared"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const JOB_ID = "job-1"
const INPUTS: ResolvedInputs = { imageUrl: "https://cdn.example/source.png" }

function build(type: string, data: Record<string, unknown>) {
  const n: SimpleNode = { id: "n-1", type, data }
  return buildPayload(n, JOB_ID, INPUTS, undefined, { nodes: [n], edges: [], nodeStates: {} })
}

// The four bodies the route parity test pins, driven through the DAG instead.
const CASES: Array<{ label: string; data: Record<string, unknown>; identifier: string; factor: string }> = [
  { label: "legacy 4K target, no factor", data: { targetResolution: "4K" }, identifier: "topaz-image-upscale:4K", factor: "4" },
  { label: "explicit 4x factor", data: { upscaleFactor: "4" }, identifier: "topaz-image-upscale:4K", factor: "4" },
  { label: "legacy 8K target maps to the 4x tier", data: { targetResolution: "8K" }, identifier: "topaz-image-upscale:4K", factor: "4" },
  { label: "2x factor overriding a stored 8K tier", data: { upscaleFactor: "2", targetResolution: "8K" }, identifier: "topaz-image-upscale", factor: "2" },
  { label: "neither lever set (provider default)", data: {}, identifier: "topaz-image-upscale", factor: "2" },
]

describe.each(["edit-image", "upscale-image"])("%s — topaz reserves the tier it renders", (nodeType) => {
  it.each(CASES)("$label", ({ data, identifier, factor }) => {
    const result = build(nodeType, { provider: "topaz-image-upscale", ...data })
    expect(result.modelIdentifier).toBe(identifier)
    expect(result.payload.upscaleFactor).toBe(factor)
    // The legacy input survives on the payload as the evidence of what was
    // asked for — the worker's own resolveTopazUpscale call must agree, not
    // form a second opinion.
    expect(result.payload.targetResolution).toBe(data.targetResolution)
  })

  it("agrees with resolveTopazUpscale for every factor/target pair", () => {
    for (const upscaleFactor of [undefined, "1", "2", "4", "8"]) {
      for (const targetResolution of [undefined, "2K", "4K", "8K"]) {
        const resolved = resolveTopazUpscale({ upscaleFactor, targetResolution })
        const result = build(nodeType, { provider: "topaz-image-upscale", upscaleFactor, targetResolution })
        expect(result.payload.upscaleFactor).toBe(resolved.upscaleFactor)
        expect(result.modelIdentifier).toBe(
          buildCreditModelIdentifier("topaz-image-upscale", undefined, undefined, undefined, resolved.creditTier),
        )
      }
    }
  })

  it("leaves a non-topaz provider's identifier and factor untouched", () => {
    const result = build(nodeType, { provider: "recraft-upscale", upscaleFactor: "4", targetResolution: "8K" })
    expect(result.modelIdentifier).toBe("recraft-upscale")
    expect(result.payload.upscaleFactor).toBe("4")
    expect(result.payload.targetResolution).toBe("8K")
  })
})
