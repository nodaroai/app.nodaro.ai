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
