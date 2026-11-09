/**
 * KIE's request funnels with an admin's content-filter setting, and without
 * one: with nothing set, the request is exactly what the caller built.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const seen = vi.hoisted(() => ({
  calls: [] as Array<{ call: { operation: string; modelKey: string | null }; body: { model: string; input?: Record<string, unknown> } & Record<string, unknown> }>,
  stopWithError: false,
  overrides: {} as Record<string, Record<string, boolean | number>>,
  guard: true,
}))

vi.mock("../../egress.js", () => ({
  providerFetch: vi.fn(async (call: { operation: string; modelKey: string | null }, _url: string, init: { body: string }) => {
    seen.calls.push({ call, body: JSON.parse(init.body) })
    if (seen.stopWithError) return new Response(JSON.stringify({ code: 400, msg: "stop-here" }), { status: 400 })
    return new Response(JSON.stringify({ code: 200, data: { taskId: "task-1" } }), { status: 200 })
  }),
}))
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), config: { KIE_API_KEY: "k", NODE_ENV: "test" } }))
vi.mock("@/lib/job-cancellation.js", () => ({ throwIfJobCancelled: async () => {}, getJobUserId: () => undefined }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ provider_safety_overrides: seen.overrides }) }))
vi.mock("@/lib/provider-safety-guard-probe.js", () => ({ contentGuardRegistered: async () => seen.guard }))
vi.mock("@/lib/result-check.js", () => ({ hasResultCheck: () => true }))

import { createKieTask } from "../client.js"
import { runFluxKontextTask } from "../kontext-client.js"
import { useProviderSafetySettings } from "../../../lib/provider-safety.js"

beforeEach(() => {
  useProviderSafetySettings()
  seen.calls.length = 0
  seen.overrides = {}
  seen.guard = true
  seen.stopWithError = false
})

describe("createKieTask with nothing set", () => {
  it("sends exactly the input the caller built", async () => {
    const input = { prompt: "a cat", resolution: "720p", nsfw_checker: false }
    await createKieTask("bytedance/seedance-2", input, { modelKey: "seedance-2", dimensions: {} })
    expect(seen.calls[0]!.body).toEqual({ model: "bytedance/seedance-2", input })
  })

  it("a model with no lever is untouched by any setting", async () => {
    seen.overrides = { veo3: { nsfw_checker: true } }
    const input = { prompt: "a cat" }
    await createKieTask("google/nano-banana-edit", input, { modelKey: "nano-banana-edit", dimensions: {} })
    expect(seen.calls[0]!.body).toEqual({ model: "google/nano-banana-edit", input })
  })
})

describe("createKieTask with a setting", () => {
  it("forces a filter on, even when the node asked for off", async () => {
    seen.overrides = { "seedance-2": { nsfw_checker: true } }
    await createKieTask("bytedance/seedance-2", { prompt: "a cat", nsfw_checker: false }, { modelKey: "seedance-2", dimensions: {} })
    expect(seen.calls[0]!.body.input).toEqual({ prompt: "a cat", nsfw_checker: true })
  })

  it("finds the lever by the wire model when no model key is threaded", async () => {
    seen.overrides = { qwen: { nsfw_checker: true } }
    await createKieTask("qwen/text-to-image", { prompt: "a cat" }, { modelKey: null, dimensions: {} })
    expect(seen.calls[0]!.body.input).toEqual({ prompt: "a cat", nsfw_checker: true })
  })

  it("loosens only a text-only request, and only with a guard", async () => {
    seen.overrides = { qwen: { enable_safety_checker: false } }
    await createKieTask("qwen/text-to-image", { prompt: "a cat" }, { modelKey: "qwen", dimensions: {} })
    expect(seen.calls[0]!.body.input).toEqual({ prompt: "a cat", enable_safety_checker: false })
    seen.calls.length = 0
    await createKieTask("qwen/image-to-image", { prompt: "a cat", image_url: "https://in.test/a.png" }, { modelKey: "qwen-i2i", dimensions: {} })
    expect(seen.calls[0]!.body.input).toEqual({ prompt: "a cat", image_url: "https://in.test/a.png" })
    seen.calls.length = 0
    seen.guard = false
    await createKieTask("qwen/text-to-image", { prompt: "a cat" }, { modelKey: "qwen", dimensions: {} })
    expect(seen.calls[0]!.body.input).toEqual({ prompt: "a cat" })
  })
})

describe("runFluxKontextTask", () => {
  it("carries no filter field while the setting is unconfirmed, whatever is saved", async () => {
    seen.overrides = { "flux-kontext-max": { safetyTolerance: 1 } }
    seen.stopWithError = true
    await runFluxKontextTask("flux-kontext-max", { prompt: "a cat", aspectRatio: "16:9" }, { modelKey: "flux-kontext-max", dimensions: {} } as never).catch(() => {})
    expect(seen.calls[0]!.body).toEqual({ model: "flux-kontext-max", prompt: "a cat", aspectRatio: "16:9" })
  })

  it("with nothing saved, the confirmed model's request carries no filter field", async () => {
    seen.stopWithError = true
    await runFluxKontextTask("flux-kontext-pro", { prompt: "a cat", aspectRatio: "16:9" }, { modelKey: "flux-kontext", dimensions: {} } as never).catch(() => {})
    expect(seen.calls[0]!.body).toEqual({ model: "flux-kontext-pro", prompt: "a cat", aspectRatio: "16:9" })
  })

  it("a stricter setting reaches the request of the model a run confirmed", async () => {
    seen.overrides = { "flux-kontext": { safetyTolerance: 1 } }
    seen.stopWithError = true
    await runFluxKontextTask("flux-kontext-pro", { prompt: "a cat", aspectRatio: "16:9" }, { modelKey: "flux-kontext", dimensions: {} } as never).catch(() => {})
    expect(seen.calls[0]!.body).toEqual({ model: "flux-kontext-pro", prompt: "a cat", aspectRatio: "16:9", safetyTolerance: 1 })
  })
})
