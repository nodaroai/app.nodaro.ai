import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  MissingProviderKeyError,
  describeEmptyCapability,
  guardProviderClient,
  liveProviderClient,
  requireProviderKey,
} from "../provider-keys.js"

/**
 * The invariant these tests protect: on a keyless install, EVERY provider
 * client entry point fails with one recognisable message that names the env
 * var and says the nodaro.ai connection doesn't cover the node — instead of a
 * raw upstream 401. The founder's soak found three different shapes for the
 * same cause; a new call site must not be able to add a fourth.
 */
describe("provider key guards", () => {
  it("names the env var and the connection gap", () => {
    const err = new MissingProviderKeyError("REPLICATE_API_TOKEN")
    expect(err.message).toContain("REPLICATE_API_TOKEN")
    expect(err.message).toContain("nodaro.ai connection")
    expect(err.message).toContain("Install health")
    expect(err.code).toBe("provider_key_missing")
  })

  it("stays short enough for a node card and a toast", () => {
    // Rendered inside a node body (truncates) and a corner toast (overflows
    // off-screen). The first version ran ~230 chars and was unreadable in
    // both — the founder saw "This node needs an API key for…" and a toast
    // running under the dock.
    const LIMIT = 140
    for (const key of ["REPLICATE_API_TOKEN", "ELEVENLABS_API_KEY", "KIE_API_KEY"] as const) {
      expect(new MissingProviderKeyError(key).message.length, key).toBeLessThanOrEqual(LIMIT)
    }
    expect(
      new MissingProviderKeyError("ELEVENLABS_API_KEY", "Text to Speech").message.length,
    ).toBeLessThanOrEqual(LIMIT + 20)
  })

  it("prefixes the operation label when one is given", () => {
    expect(new MissingProviderKeyError("KIE_API_KEY", "Face Swap").message).toMatch(
      /^Face Swap: needs your own KIE_API_KEY/,
    )
  })

  it("requireProviderKey throws on empty and passes on set", () => {
    expect(() => requireProviderKey("", "FAL_KEY")).toThrow(MissingProviderKeyError)
    expect(() => requireProviderKey(undefined, "FAL_KEY")).toThrow(MissingProviderKeyError)
    expect(() => requireProviderKey("fal-abc", "FAL_KEY")).not.toThrow()
  })

  describe("guardProviderClient", () => {
    it("blocks ANY property access while the key is unset — including call sites nobody guarded", () => {
      const sdk = { predictions: { create: vi.fn() }, run: vi.fn(), wait: vi.fn() }
      const guarded = guardProviderClient(sdk, "REPLICATE_API_TOKEN", () => "")
      // Every documented entry point, not just the one wrapper we remembered.
      expect(() => guarded.run).toThrow(MissingProviderKeyError)
      expect(() => guarded.wait).toThrow(MissingProviderKeyError)
      expect(() => guarded.predictions).toThrow(MissingProviderKeyError)
      expect(sdk.run).not.toHaveBeenCalled()
    })

    it("is transparent once the key is set", () => {
      const sdk = { run: vi.fn().mockReturnValue("ok"), nested: { deep: 1 } }
      let key = ""
      const guarded = guardProviderClient(sdk, "REPLICATE_API_TOKEN", () => key)
      expect(() => guarded.run).toThrow()
      key = "r8_live"
      expect(guarded.run()).toBe("ok")
      expect(guarded.nested.deep).toBe(1)
    })

    it("re-checks per access, so a key configured later starts working without a restart", () => {
      let key = ""
      const guarded = guardProviderClient({ run: () => "ran" }, "KIE_API_KEY", () => key)
      expect(() => guarded.run).toThrow(MissingProviderKeyError)
      key = "kie-abc"
      expect(guarded.run()).toBe("ran")
      key = ""
      expect(() => guarded.run).toThrow(MissingProviderKeyError)
    })
  })

  // SDK singletons that take the key at CONSTRUCTION (Replicate's `auth`,
  // Gemini's `apiKey`) would keep serving a stale key after the operator
  // pastes a new one on /setup. liveProviderClient builds the client from the
  // key that is in force and rebuilds when it changes — no restart, no stale
  // credential.
  describe("liveProviderClient", () => {
    it("builds lazily from the current key and rebuilds only when the key changes", () => {
      let key = "r8_one"
      const factory = vi.fn((auth: string) => ({ auth, run: () => `ran:${auth}` }))
      const live = liveProviderClient(factory, "REPLICATE_API_TOKEN", () => key)
      expect(factory).not.toHaveBeenCalled()
      expect(live.run()).toBe("ran:r8_one")
      expect(live.run()).toBe("ran:r8_one")
      expect(factory).toHaveBeenCalledTimes(1)
      key = "r8_two"
      expect(live.run()).toBe("ran:r8_two")
      expect(factory).toHaveBeenCalledTimes(2)
      expect(factory).toHaveBeenLastCalledWith("r8_two")
    })

    it("guards like guardProviderClient while the key is unset", () => {
      let key = ""
      const live = liveProviderClient((auth: string) => ({ auth, run: () => "ran" }), "GEMINI_API_KEY", () => key)
      expect(() => live.run).toThrow(MissingProviderKeyError)
      key = "gm_live"
      expect(live.run()).toBe("ran")
    })
  })
})

describe("the shared Replicate singleton is guarded at the boundary", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("throws the shared error instead of reaching api.replicate.com when the token is empty", async () => {
    vi.doMock("../../lib/config.js", () => ({ config: { REPLICATE_API_TOKEN: "" } }))
    const { replicate } = await import("../replicate/client.js")
    // Direct singleton use — the path audio/*, sfx.ts, ltx-video.ts and the
    // worker handlers take, which bypasses runReplicatePrediction entirely.
    // Asserted by shape, not `instanceof`: resetModules gives this import
    // chain its own copy of provider-keys.js, so the thrown class is a
    // different object than the one this file imported statically.
    expect(() => replicate.predictions).toThrow(/REPLICATE_API_TOKEN/)
    expect(() => replicate.run).toThrow(/nodaro\.ai connection/)
    try {
      void replicate.run
      throw new Error("expected the guarded singleton to throw")
    } catch (err) {
      expect((err as { code?: string }).code).toBe("provider_key_missing")
    }
  })
})

describe("describeEmptyCapability — why nothing served the request", () => {
  const allSet = {
    REPLICATE_API_TOKEN: "r8",
    KIE_API_KEY: "kie",
    ELEVENLABS_API_KEY: "el",
    ANTHROPIC_API_KEY: "an",
    GEMINI_API_KEY: "gm",
    FAL_KEY: "fal",
    HEYGEN_API_KEY: "hg",
    BEEBLE_API_KEY: "bb",
    APIFY_API_TOKEN: "ap",
  } as const

  it("blames the missing keys — not the model — when any key is unset", () => {
    const msg = describeEmptyCapability(
      "lip-sync",
      "kling-avatar",
      { ...allSet, KIE_API_KEY: "", REPLICATE_API_TOKEN: "" },
      true,
    )
    // The old wording read as "this model is broken"; a self-hoster can't act on that.
    expect(msg).not.toContain("is not supported")
    expect(msg).toContain("KIE_API_KEY")
    expect(msg).toContain("nodaro.ai connection")
    expect(msg).toContain("Install health")
    expect(msg.length).toBeLessThanOrEqual(160)
  })

  it("omits the cloud note when the instance isn't connected", () => {
    const msg = describeEmptyCapability("lip-sync", "x", { ...allSet, KIE_API_KEY: "" }, false)
    expect(msg).not.toContain("nodaro.ai connection")
    expect(msg).toContain("no provider is configured")
    expect(msg).toContain("KIE_API_KEY")
  })

  it("keeps the unknown-model wording once every key is configured", () => {
    expect(describeEmptyCapability("image-generation", "nope", allSet, false)).toBe(
      'Model "nope" is not supported for image-generation by any registered provider',
    )
  })
})
