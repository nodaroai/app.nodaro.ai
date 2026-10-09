import { describe, it, expect, beforeEach } from "vitest"
import {
  SPEAKER_FRAMES_RELAY_FAILURE_TTL_MS,
  SPEAKER_FRAMES_RELAY_TTL_MS,
  speakerFramesRelaySupport,
  _resetSpeakerFramesRelaySupportForTests,
  type SpeakerFramesRelaySupportDeps,
} from "../speaker-frames-relay-support.js"
import type { PluginSupports } from "../types.js"

/**
 * Whether Speaker Frames can run from this install (P3.6, decided 2026-10-09):
 * a connected self-host relays it only once nodaro.ai's plugin accepts the
 * relayed shape (proxies + the relayed marker) — feature-detected, never
 * assumed, so an install never sends a request nodaro.ai would mis-run.
 */
let now = 0
let calls: string[] = []
const deps = (over: Partial<SpeakerFramesRelaySupportDeps> = {}): SpeakerFramesRelaySupportDeps => ({
  hasCredits: () => false,
  getPluginSupports: () => ({}),
  isNodaroConnected: async () => true,
  cloudFetch: async (path) => {
    calls.push(path)
    return new Response(JSON.stringify({ relay: true }), { status: 200 })
  },
  now: () => now,
  ...over,
})

beforeEach(() => {
  _resetSpeakerFramesRelaySupportForTests()
  now = 0
  calls = []
})

describe("speakerFramesRelaySupport", () => {
  it("nodaro.ai answers from its loaded plugin's declaration, with no call out", async () => {
    expect(await speakerFramesRelaySupport(deps({ hasCredits: () => true, getPluginSupports: () => ({ speakerFramesRelayedProxies: true }) }))).toEqual({ relay: true, source: "server" })
    expect(await speakerFramesRelaySupport(deps({ hasCredits: () => true }))).toEqual({ relay: false, source: "server" })
    expect(calls).toEqual([])
  })

  // The key is the plugin's, verbatim: cloud-plugins declares
  // `supports().speakerFramesRelayedProxies` (and names it so in its contract
  // docs). Any other spelling reads as absent, so nodaro.ai would refuse every
  // relayed job while the plugin accepts them.
  it("reads exactly the key the plugin declares: speakerFramesRelayedProxies", async () => {
    const declared: keyof PluginSupports = "speakerFramesRelayedProxies"
    const server = (supports: PluginSupports) => deps({ hasCredits: () => true, getPluginSupports: () => supports })
    expect(await speakerFramesRelaySupport(server({ [declared]: true }))).toEqual({ relay: true, source: "server" })
    const otherSpelling = { speakerFramesRelay: true } as unknown as PluginSupports
    expect(await speakerFramesRelaySupport(server(otherSpelling))).toEqual({ relay: false, source: "server" })
  })

  // A workflow run reaches the relay worker without the route's connection
  // gate: the answer must say WHY, so the worker refuses with the connection
  // instruction rather than "not available on a connected install yet".
  it("an unconnected self-host relays nothing, and says it is not connected", async () => {
    expect(await speakerFramesRelaySupport(deps({ isNodaroConnected: async () => false }))).toEqual({ relay: false, source: "not-connected" })
    expect(calls).toEqual([])
  })

  it("a connected self-host asks nodaro.ai's own capabilities route and caches the answer", async () => {
    expect(await speakerFramesRelaySupport(deps())).toEqual({ relay: true, source: "nodaro.ai" })
    expect(calls).toEqual(["/v1/speaker-frames/capabilities"])
    now = SPEAKER_FRAMES_RELAY_TTL_MS - 1
    await speakerFramesRelaySupport(deps())
    expect(calls).toHaveLength(1)
    now = SPEAKER_FRAMES_RELAY_TTL_MS + 1
    await speakerFramesRelaySupport(deps())
    expect(calls).toHaveLength(2)
  })

  it("a nodaro.ai from before the route (404) or one that does not relay yet answers false", async () => {
    expect(await speakerFramesRelaySupport(deps({ cloudFetch: async () => new Response("", { status: 404 }) }))).toEqual({ relay: false, source: "nodaro.ai" })
    _resetSpeakerFramesRelaySupportForTests()
    expect(await speakerFramesRelaySupport(deps({ cloudFetch: async () => new Response(JSON.stringify({ relay: false }), { status: 200 }) }))).toEqual({ relay: false, source: "nodaro.ai" })
    _resetSpeakerFramesRelaySupportForTests()
    // Only a literal true counts.
    expect(await speakerFramesRelaySupport(deps({ cloudFetch: async () => new Response(JSON.stringify({ relay: "yes" }), { status: 200 }) }))).toEqual({ relay: false, source: "nodaro.ai" })
  })

  it("fails closed when nodaro.ai can't be reached, says so, and asks again soon", async () => {
    const down = deps({ cloudFetch: async (p) => { calls.push(p); throw new Error("ECONNREFUSED") } })
    expect(await speakerFramesRelaySupport(down)).toEqual({ relay: false, source: "nodaro.ai-unreachable" })
    expect(await speakerFramesRelaySupport(deps({ cloudFetch: async (p) => { calls.push(p); return new Response("", { status: 502 }) } }))).toEqual({ relay: false, source: "nodaro.ai-unreachable" })
    expect(calls).toHaveLength(1)
    now = SPEAKER_FRAMES_RELAY_FAILURE_TTL_MS + 1
    expect(await speakerFramesRelaySupport(deps())).toEqual({ relay: true, source: "nodaro.ai" })
  })

  // A revoked or expired credential is an answer about the connection, not an
  // outage: never "couldn't reach nodaro.ai", never retried as transient.
  it("a 401/403 from nodaro.ai says the connection was rejected, and asks again soon", async () => {
    for (const status of [401, 403]) {
      _resetSpeakerFramesRelaySupportForTests()
      calls = []
      now = 0
      const rejecting = deps({ cloudFetch: async (p) => { calls.push(p); return new Response("", { status }) } })
      expect(await speakerFramesRelaySupport(rejecting)).toEqual({ relay: false, source: "nodaro.ai-rejected" })
      expect(await speakerFramesRelaySupport(rejecting)).toEqual({ relay: false, source: "nodaro.ai-rejected" })
      expect(calls).toHaveLength(1)
      // A reconnect is picked up within the short failure TTL.
      now = SPEAKER_FRAMES_RELAY_FAILURE_TTL_MS + 1
      expect(await speakerFramesRelaySupport(deps())).toEqual({ relay: true, source: "nodaro.ai" })
    }
  })
})
