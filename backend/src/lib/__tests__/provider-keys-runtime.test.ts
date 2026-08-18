/**
 * The one place that decides which provider key is in force. Both
 * `config.<PROVIDER>_KEY` (via getters installed by config.ts) and the setup
 * screen's tile source read THROUGH resolveProviderKey(), so they cannot
 * disagree. Precedence: an environment variable WINS over an app-managed
 * value (decision 2026-08-16: declared configuration beats stored); the
 * app-managed value fills in only where env is empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  PROVIDER_KEY_ENV,
  PROVIDER_KEY_IDS,
  PROVIDER_KEY_META,
  applyAppSnapshot,
  envVarFor,
  getProviderKeyOverride,
  providerIdFor,
  resolveProviderKey,
  resolveProviderKeyRaw,
  setProviderKeyOverrides,
  setEnvProviderKeys,
  setEnvProviderKey,
  subscribeProviderKeys,
  _resetProviderKeysRuntimeForTests,
} from "../provider-keys-runtime.js"

beforeEach(() => {
  _resetProviderKeysRuntimeForTests()
})

describe("provider id <-> env var mapping", () => {
  it("covers every provider key the backend knows, nodaro first", () => {
    // HeyGen (AI Avatar / Cinematic Avatar), Beeble (Relight & Switch) and
    // Apify were keys the backend required but the setup screen never
    // showed — a keyless install failed those nodes with "add HEYGEN_API_KEY"
    // without ever having said such a key exists (founder, 2026-08-16).
    expect(PROVIDER_KEY_IDS).toEqual([
      "nodaro", "kie", "replicate", "anthropic", "gemini", "elevenlabs", "fal", "heygen", "beeble", "apify",
    ])
    expect(PROVIDER_KEY_ENV.kie).toBe("KIE_API_KEY")
    expect(PROVIDER_KEY_ENV.heygen).toBe("HEYGEN_API_KEY")
    expect(envVarFor("nodaro")).toBe("NODARO_API_KEY")
    expect(providerIdFor("REPLICATE_API_TOKEN")).toBe("replicate")
    expect(providerIdFor("PORT")).toBeNull()
  })

  it("says which providers the nodaro.ai connection stands in for", () => {
    // The connection routes image / video / speech / LLM work through the
    // cloud, and — since the vendor-direct nodes replay their jobs on it
    // (providers/nodaro/run-on-cloud.ts) — HeyGen, Beeble and Apify too.
    // Every key but nodaro.ai itself is cleared by connecting. The setup
    // screen's banner and the "own key needed" note derive from this, not
    // from a hand-written count.
    const covered = PROVIDER_KEY_IDS.filter((id) => PROVIDER_KEY_META[id].cloudCovered)
    expect(covered).toEqual(["kie", "replicate", "anthropic", "gemini", "elevenlabs", "fal", "heygen", "beeble", "apify"])
    expect(PROVIDER_KEY_META.nodaro.cloudCovered).toBe(false) // it IS the connection
    expect(PROVIDER_KEY_META.heygen.cloudCovered).toBe(true)
    expect(PROVIDER_KEY_META.heygen.name).toBe("HeyGen")
    expect(PROVIDER_KEY_META.heygen.powers).toMatch(/avatar/i)
  })
})

describe("resolveProviderKey", () => {
  it("is null when neither env nor app has a value", () => {
    setEnvProviderKeys({ kie: "", replicate: "" })
    expect(resolveProviderKey("kie")).toBeNull()
  })

  it("returns the env value with source env", () => {
    setEnvProviderKeys({ kie: "kie_from_env" })
    expect(resolveProviderKey("kie")).toEqual({ value: "kie_from_env", source: "env" })
  })

  it("falls back to the app-managed value with source app", () => {
    setEnvProviderKeys({ kie: "" })
    applyAppSnapshot({ kie: "kie_from_app" })
    expect(resolveProviderKey("kie")).toEqual({ value: "kie_from_app", source: "app" })
  })

  it("env WINS when both exist", () => {
    setEnvProviderKeys({ kie: "kie_from_env" })
    applyAppSnapshot({ kie: "kie_from_app" })
    expect(resolveProviderKey("kie")).toEqual({ value: "kie_from_env", source: "env" })
  })

  it("treats blank env as unset (a `KIE_API_KEY=` line in .env must not shadow the app value)", () => {
    setEnvProviderKeys({ kie: "   " })
    applyAppSnapshot({ kie: "kie_from_app" })
    expect(resolveProviderKey("kie")).toEqual({ value: "kie_from_app", source: "app" })
  })

  it("a later snapshot replaces the earlier one entirely (a cleared row disappears)", () => {
    setEnvProviderKeys({})
    applyAppSnapshot({ kie: "a", fal: "b" })
    applyAppSnapshot({ fal: "b" })
    expect(resolveProviderKey("kie")).toBeNull()
    expect(resolveProviderKey("fal")).toEqual({ value: "b", source: "app" })
  })
})

describe("setEnvProviderKey (what tests do when they assign config.X_KEY)", () => {
  it("updates the env layer for that provider only", () => {
    setEnvProviderKeys({ kie: "a", fal: "b" })
    setEnvProviderKey("kie", "c")
    expect(resolveProviderKey("kie")?.value).toBe("c")
    expect(resolveProviderKey("fal")?.value).toBe("b")
  })
})

describe("subscribeProviderKeys", () => {
  it("fires with the ids whose effective value changed, and only those", () => {
    setEnvProviderKeys({ kie: "env" })
    const seen: string[][] = []
    const off = subscribeProviderKeys((changed) => {
      seen.push([...changed])
    })
    applyAppSnapshot({ kie: "app-ignored-because-env-wins", fal: "f1" })
    applyAppSnapshot({ fal: "f1" }) // no effective change
    applyAppSnapshot({ fal: "f2" })
    applyAppSnapshot({}) // fal cleared
    off()
    applyAppSnapshot({ fal: "f3" }) // after unsubscribe
    expect(seen).toEqual([["fal"], ["fal"], ["fal"]])
  })

  it("applyAppSnapshot resolves with the changed ids once every listener (sync or async) has settled", async () => {
    const order: string[] = []
    const off1 = subscribeProviderKeys(() => {
      order.push("sync")
    })
    const off2 = subscribeProviderKeys(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push("async")
    })
    try {
      const changed = await applyAppSnapshot({ kie: "k1", fal: "f1" })
      expect([...changed].sort()).toEqual(["fal", "kie"])
      expect(order).toEqual(["sync", "async"])
      await expect(applyAppSnapshot({ kie: "k1", fal: "f1" })).resolves.toEqual([])
    } finally {
      off1()
      off2()
    }
  })

  it("a listener that throws or rejects is logged and does not break the others or the caller", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    const offs = [
      subscribeProviderKeys(() => {
        throw new Error("sync boom")
      }),
      subscribeProviderKeys(async () => {
        throw new Error("async boom")
      }),
      subscribeProviderKeys(() => {
        seen.push("ok")
      }),
    ]
    try {
      await expect(applyAppSnapshot({ kie: "k2" })).resolves.toEqual(["kie"])
      expect(seen).toEqual(["ok"])
      expect(errSpy).toHaveBeenCalledTimes(2)
    } finally {
      offs.forEach((off) => off())
      errSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// 4b overrides layer: disable + ignoreEnv on top of the two key layers
// ---------------------------------------------------------------------------
describe("provider overrides (4b)", () => {
  it("disabled: effective resolution is ABSENT, the raw layers still show the key (tiles say 'disabled', never 'missing')", async () => {
    setEnvProviderKeys({ kie: "kie-env" })
    await setProviderKeyOverrides({ kie: { disabled: true } })
    expect(resolveProviderKey("kie")).toBeNull()
    expect(resolveProviderKeyRaw("kie")).toEqual({ value: "kie-env", source: "env" })
    expect(getProviderKeyOverride("kie")).toEqual({ disabled: true })
  })

  it("ignoreEnv: the env layer is skipped so an app key REPLACES a .env key", async () => {
    setEnvProviderKeys({ kie: "kie-env" })
    await applyAppSnapshot({ kie: "kie-app" })
    expect(resolveProviderKey("kie")).toEqual({ value: "kie-env", source: "env" }) // env wins normally
    await setProviderKeyOverrides({ kie: { ignoreEnv: true } })
    expect(resolveProviderKey("kie")).toEqual({ value: "kie-app", source: "app" })
    // Raw stays layer-honest: env is still the top raw layer.
    expect(resolveProviderKeyRaw("kie")).toEqual({ value: "kie-env", source: "env" })
  })

  it("ignoreEnv with no app key resolves ABSENT — the override never invents a credential", async () => {
    setEnvProviderKeys({ kie: "kie-env" })
    await setProviderKeyOverrides({ kie: { ignoreEnv: true } })
    expect(resolveProviderKey("kie")).toBeNull()
  })

  it("setProviderKeyOverrides notifies with the ids whose EFFECTIVE value changed — disable re-routes immediately", async () => {
    setEnvProviderKeys({ kie: "kie-env", fal: "fal-env" })
    const seen: string[][] = []
    const unsubscribe = subscribeProviderKeys((changed) => {
      seen.push([...changed])
    })
    const changed = await setProviderKeyOverrides({ kie: { disabled: true } })
    expect(changed).toEqual(["kie"]) // fal untouched
    expect(seen).toEqual([["kie"]])
    // Re-enabling notifies again; an override write that changes nothing does not.
    await setProviderKeyOverrides({})
    expect(seen).toEqual([["kie"], ["kie"]])
    await setProviderKeyOverrides({})
    expect(seen).toEqual([["kie"], ["kie"]])
    unsubscribe()
  })
})
