/** fal's lip-sync request: untouched with nothing set, and never loosened (it works from a real person's footage). */
import { beforeEach, describe, expect, it, vi } from "vitest"

const seen = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>>, overrides: {} as Record<string, Record<string, boolean | number>>, guard: true }))
vi.mock("../client.js", () => ({
  runFalRequest: vi.fn(async (opts: { input: Record<string, unknown> }) => {
    seen.inputs.push(opts.input)
    return { output: { video: { url: "https://out.test/a.mp4" } } }
  }),
  extractFalUrl: () => "https://out.test/a.mp4",
}))
vi.mock("../pricing.js", () => ({ falCostUsd: () => 0 }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ provider_safety_overrides: seen.overrides }) }))
vi.mock("@/lib/provider-safety-guard-probe.js", () => ({ contentGuardRegistered: async () => seen.guard }))
vi.mock("@/lib/result-check.js", () => ({ hasResultCheck: () => true }))

import { falLipSync } from "../lip-sync.js"
import { useProviderSafetySettings } from "../../../lib/provider-safety.js"

const run = () => falLipSync("sync-lipsync-v3", "https://in.test/v.mp4", "https://in.test/a.mp3")

beforeEach(() => {
  useProviderSafetySettings()
  seen.inputs.length = 0
  seen.overrides = {}
  seen.guard = true
})

describe("falLipSync", () => {
  it("sends today's request with nothing set", async () => {
    await run()
    expect(seen.inputs[0]).toEqual({ video_url: "https://in.test/v.mp4", audio_url: "https://in.test/a.mp3" })
  })

  it("ignores a looser setting: this model is never loosened", async () => {
    seen.overrides = { "sync-lipsync-v3": { enable_safety_checker: false } }
    await run()
    expect(seen.inputs[0]).toEqual({ video_url: "https://in.test/v.mp4", audio_url: "https://in.test/a.mp3" })
  })
})
