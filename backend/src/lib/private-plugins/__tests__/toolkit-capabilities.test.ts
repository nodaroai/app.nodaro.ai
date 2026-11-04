import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { buildToolkit } from "../toolkit.js"
import { CONTRACT_VERSION, type NodaroPrivatePlugin, type PrivatePluginsModule } from "../types.js"

/**
 * `tk.capabilities` is the additive marker a plugin reads to learn what THIS
 * host supports. `CONTRACT_VERSION` is an exact-match integer (a mismatch is
 * fatal on cloud), so it cannot say "this host also understands `duck`" and
 * bumping it would stop every published plugin from loading. Decided
 * 2026-10-06: ship capability markers, leave the version alone.
 */
describe("tk.capabilities", () => {
  it("advertises mix-audio ducking", () => {
    expect(buildToolkit().capabilities?.mixAudioDuck).toBe(true)
  })

  it("advertises the lossless/local applyAudioFx output options", () => {
    // An older host ignores `format: "wav"` silently and hands back an mp3, so
    // a plugin must read this flag before relying on it.
    expect(buildToolkit().capabilities?.audioFxLossless).toBe(true)
  })

  it("advertises that the Voice Changer Pro pricing applies the translated Re-speak allowance itself", () => {
    // An older host ignores `respeakTranslated` silently and reserves the
    // transcript at 1×, so the plugin multiplies the characters itself unless
    // this is true — and must not, where it is (that would reserve 2.25×).
    expect(buildToolkit().capabilities?.voiceChangerProRespeakSlotArgs).toBe(true)
  })

  it("advertises that internalRequest honours a declared provenance", () => {
    // An older host ignores `provenance` / `request` silently: the job then
    // carries no origin and no session, so a plugin gates on this flag.
    expect(buildToolkit().capabilities?.internalRequestProvenance).toBe(true)
  })

  it("advertises tk.settings.nodaroMotionMasking, and has it", () => {
    // An older host has no tk.settings at all: the plugin reads that as never saved (no masking).
    const tk = buildToolkit()
    expect(tk.capabilities?.nodaroMotionMasking).toBe(true)
    expect(typeof tk.settings?.nodaroMotionMasking).toBe("function")
  })

  it("advertises tk.http.quoteSeedanceRefVideo, and has it", () => {
    // An older host has no such member: the Cast Swap plugin derives its
    // Seedance hold itself unless this is true.
    const tk = buildToolkit()
    expect(tk.capabilities?.seedanceRefVideoQuote).toBe(true)
    expect(typeof tk.http.quoteSeedanceRefVideo).toBe("function")
  })

  it("advertises that a plugin can declare its job types' concurrency lanes", () => {
    // tk.capabilities.jobLanes === true: the loader reads NodaroPrivatePlugin.jobLanes().
    expect(buildToolkit().capabilities?.jobLanes).toBe(true)
  })

  it("advertises a queue-aware tk.jobs.waitForJob", () => {
    // A child's queued time does not count against the plugin's timeout
    // (toolkit-wait-queue-aware.test.ts proves the wait itself).
    expect(buildToolkit().capabilities?.queueAwareWait).toBe(true)
  })

  it("advertises idempotent keyed chat child calls", () => {
    // llm-chat-idempotency.test.ts proves the route: the same key answers the
    // first call's text, waits for one still running, and refuses another body.
    expect(buildToolkit().capabilities?.llmChatIdempotency).toBe(true)
  })

  it("advertises a workflow estimate that prices an llm-chat node at its own expected usage", () => {
    // ee/billing/__tests__/llm-chat-expected-usage.test.ts proves the pricing.
    expect(buildToolkit().capabilities?.llmChatEstimateUsage).toBe(true)
  })

  it("advertises the video scene cuts route", () => {
    // routes/__tests__/video-scene-cuts.test.ts proves the route: a child of a
    // job only, the cuts of a real clip in seconds from its first frame.
    expect(buildToolkit().capabilities?.videoSceneCuts).toBe(true)
  })

  it("advertises that the face mesh route draws only the parts a child asks for", () => {
    // routes/__tests__/video-face-mesh.test.ts and services/face-mesh/__tests__ prove the route and the drawing.
    expect(buildToolkit().capabilities?.videoFaceMeshParts).toBe(true)
  })

  it("advertises a pitch shift of up to two octaves in one pass", () => {
    // providers/video/__tests__/pitch-tempo-two-octaves.test.ts proves the filter: ±24 and the half steps, one pass.
    expect(buildToolkit().capabilities?.pitchTempoTwoOctaves).toBe(true)
  })

  it("is a stable, frozen snapshot, not a per-call mutable object", () => {
    const caps = buildToolkit().capabilities
    expect(caps).toBeDefined()
    expect(Object.isFrozen(caps)).toBe(true)
    expect(buildToolkit().capabilities).toEqual(caps)
  })

  it("leaves a plugin that never reads it unaffected", () => {
    const oldPlugin: NodaroPrivatePlugin = {
      name: "legacy",
      handlers: (tk) => ({ "legacy-job": async () => { void tk.media.mixAudio } }),
    }
    const handlers = oldPlugin.handlers!(buildToolkit())
    expect(Object.keys(handlers)).toEqual(["legacy-job"])
  })

  it("does not bump CONTRACT_VERSION", () => {
    expect(CONTRACT_VERSION).toBe(1)
    const mod: PrivatePluginsModule = { contractVersion: 1, plugins: [] }
    expect(mod.contractVersion).toBe(CONTRACT_VERSION)
  })
})
