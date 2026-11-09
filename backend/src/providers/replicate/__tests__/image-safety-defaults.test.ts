/**
 * The request bodies Replicate's image models send with nothing changed by an
 * admin: pinned here so a new setting cannot move today's requests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const seen = vi.hoisted(() => ({ inputs: [] as Array<{ model?: string; version?: string; input: Record<string, unknown> }>, overrides: {} as Record<string, Record<string, boolean | number>>, guard: true }))

vi.mock("../client.js", () => ({
  extractUrl: (x: unknown) => String(x),
  runReplicatePrediction: vi.fn(async (opts: { model?: string; version?: string; input: Record<string, unknown> }) => {
    seen.inputs.push(opts)
    return { output: "https://out.test/a.png", cost: 0.01, predictionId: "p1" }
  }),
}))
vi.mock("../topaz.js", () => ({ runTopazImageUpscale: vi.fn() }))
vi.mock("../../../lib/translate.js", () => ({ translateToEnglish: async (p: string) => p }))
vi.mock("../../../lib/pricing/flux2-cost.js", () => ({ flux2CostUsd: () => 0 }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ provider_safety_overrides: seen.overrides }) }))
vi.mock("../../../lib/provider-safety-guard-probe.js", () => ({ contentGuardRegistered: async () => seen.guard }))
vi.mock("../../../lib/result-check.js", () => ({ hasResultCheck: () => true }))

import { ReplicateImageProvider } from "../image.js"
import { useProviderSafetySettings } from "../../../lib/provider-safety.js"

const provider = new ReplicateImageProvider()

beforeEach(() => {
  useProviderSafetySettings()
  seen.inputs.length = 0
  seen.overrides = {}
  seen.guard = true
})

async function sent(model: string, refs?: string[], extra?: Record<string, unknown>): Promise<Record<string, unknown>> {
  await provider.generateImage("a cat on a boat", refs, model, { aspect_ratio: "1:1", ...extra })
  return seen.inputs[0]!.input
}

describe("Replicate image requests with nothing changed", () => {
  it("flux-2-pro and flux-2-max keep safety_tolerance 5", async () => {
    expect(await sent("flux-2-pro")).toEqual({ prompt: "a cat on a boat", aspect_ratio: "1:1", output_format: "png", safety_tolerance: 5, resolution: "1 MP" })
    seen.inputs.length = 0
    expect(await sent("flux-2-max")).toEqual({ prompt: "a cat on a boat", aspect_ratio: "1:1", output_format: "png", safety_tolerance: 5, resolution: "1 MP" })
  })

  it("flux-fill keeps safety_tolerance 5", async () => {
    await provider.generateImage("a cat", ["https://in.test/a.png"], "flux-fill", { aspect_ratio: "1:1", mask_url: "https://in.test/m.png" })
    expect(seen.inputs[0]!.input).toEqual({ prompt: "a cat", output_format: "png", safety_tolerance: 5, image: "https://in.test/a.png", mask: "https://in.test/m.png" })
  })

  it("flux-2-klein and kontext-multi send no filter parameter", async () => {
    expect(await sent("flux-2-klein")).toEqual({ prompt: "a cat on a boat", aspect_ratio: "1:1", megapixels: "1" })
    seen.inputs.length = 0
    expect(await sent("kontext-multi", ["https://in.test/a.png"])).toEqual({ prompt: "a cat on a boat", aspect_ratio: "1:1", output_format: "png", input_image_1: "https://in.test/a.png" })
  })

  it("a loosening applies only to a text-only run", async () => {
    seen.overrides = { "flux-2-klein": { disable_safety_checker: true } }
    expect((await sent("flux-2-klein")).disable_safety_checker).toBe(true)
    seen.inputs.length = 0
    // The same setting with a reference image: today's request, untouched.
    expect(await sent("flux-2-klein", ["https://in.test/a.png"])).toEqual({ prompt: "a cat on a boat", aspect_ratio: "1:1", megapixels: "1", images: ["https://in.test/a.png"] })
  })

  it("a stricter setting applies on a model that is never loosened, even with its input image", async () => {
    seen.overrides = { "flux-fill": { safety_tolerance: 2 } }
    await provider.generateImage("a cat", ["https://in.test/a.png"], "flux-fill", { mask_url: "https://in.test/m.png" })
    expect(seen.inputs[0]!.input.safety_tolerance).toBe(2)
  })

  it("a character LoRA is never loosened: the setting is ignored", async () => {
    seen.overrides = { "flux-lora-character": { disable_safety_checker: true } }
    await provider.generateImage("a cat", undefined, "flux-lora-character", { lora_version: "owner/char:abc", lora_trigger: "TOK" })
    expect(seen.inputs[0]!.input).not.toHaveProperty("disable_safety_checker")
  })
})
