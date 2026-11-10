/**
 * Runtime config (release check 13, #700): the published image is built once
 * and must serve any PUBLIC_URL. `/config.js` sets window.__NODARO_RUNTIME__
 * before the app loads; these getters prefer it and fall back to the
 * build-time VITE_* value — and NOTHING else in src reads those three
 * VITE_* directly, or a fresh port breaks again.
 */
import { describe, it, expect, afterEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { runtimeApiUrl, runtimeDefaultLocale, runtimeFlowUiOrigin, runtimeIsOnFlowUiHost, runtimeIsOnMovedHost, runtimeLegacyUiHosts, runtimeLinkOrigin, runtimeMediaOrigin, runtimeSupabaseAnonKey, runtimeSupabaseUrl, runtimeUploadModerationEnabled, runtimePreviewStopRule } from "../runtime-config"

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

describe("runtime-config getters", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("prefer the runtime override when present and non-empty", () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "http://localhost:3010", supabaseUrl: "http://localhost:3010/supabase", supabaseAnonKey: "anon-runtime" }
    expect(runtimeApiUrl()).toBe("http://localhost:3010")
    expect(runtimeSupabaseUrl()).toBe("http://localhost:3010/supabase")
    expect(runtimeSupabaseAnonKey()).toBe("anon-runtime")
  })

  it("resolves the managed Supabase proxy against the current studio origin", () => {
    window.__NODARO_RUNTIME__ = { supabaseUrl: "/supabase" }
    expect(runtimeSupabaseUrl()).toBe(`${window.location.origin}/supabase`)
  })

  it("fall back to the build-time value when the override is missing or blank", () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "  ", supabaseUrl: "" }
    expect(runtimeApiUrl()).toBe(import.meta.env.VITE_API_URL ?? "")
    expect(runtimeSupabaseUrl()).toBe(import.meta.env.VITE_SUPABASE_URL ?? "")
    delete window.__NODARO_RUNTIME__
    expect(runtimeSupabaseAnonKey()).toBe(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "")
  })
})

/**
 * The same-origin sentinel. A hosted studio reachable on more than one
 * hostname cannot name its API host in `apiUrl`: PUBLIC_URL is single-valued and
 * whichever host it names would be the one every SSE call goes to, from every
 * other host. `PUBLIC_URL_SAME_ORIGIN=true` makes the /config.js writer emit
 * `apiUrl: "/"`, which reads here as "" — the value the four SSE consumers
 * already treat as same-origin.
 */
describe("runtimeApiUrl same-origin sentinel", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it('reads "/" as same-origin ("")', () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "/" }
    expect(runtimeApiUrl()).toBe("")
  })

  it('reads a padded "/" the same way (the writer trims, this does not depend on it)', () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "  /  " }
    expect(runtimeApiUrl()).toBe("")
  })

  it("leaves every other value alone — including a path-suffixed origin", () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "https://api.example.com" }
    expect(runtimeApiUrl()).toBe("https://api.example.com")
    window.__NODARO_RUNTIME__ = { apiUrl: "https://api.example.com/" }
    expect(runtimeApiUrl()).toBe("https://api.example.com/")
    window.__NODARO_RUNTIME__ = { apiUrl: "/api" }
    expect(runtimeApiUrl()).toBe("/api")
  })

  it("is unaffected when no override is set (the baked value still wins)", () => {
    delete window.__NODARO_RUNTIME__
    expect(runtimeApiUrl()).toBe(import.meta.env.VITE_API_URL ?? "")
  })
})

describe("runtimeDefaultLocale (A3 — deployment default locale)", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("returns the runtime override, trimmed", () => {
    window.__NODARO_RUNTIME__ = { defaultLocale: "  he  " }
    expect(runtimeDefaultLocale()).toBe("he")
  })

  it("returns empty when missing or blank — it is runtime-only, no build-time default", () => {
    window.__NODARO_RUNTIME__ = { defaultLocale: "   " }
    expect(runtimeDefaultLocale()).toBe("")
    delete window.__NODARO_RUNTIME__
    expect(runtimeDefaultLocale()).toBe("")
  })
})

describe("no direct reads of the three runtime-configurable VITE_* values", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (name === "__tests__" || name === "node_modules") continue
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(p)
    }
    return out
  }
  // FREECUT_URL joined the set in #767, and AUDIOMASS_URL alongside it, for the
  // same reason as the trio: the published image is built once, and a direct
  // import.meta.env read would silently bypass the /config.js override an
  // operator set to point at their own editor — the exact failure the runtime
  // layer exists to prevent. (The regex previously named only the trio even
  // though the comment claimed FreeCut had joined; both editors are enforced now.)
  it("every runtime-overridable VITE_* read goes through runtime-config.ts", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join("lib", "runtime-config.ts")))
      .filter((f) => /import\.meta\.env\.VITE_(API_URL|SUPABASE_URL|SUPABASE_ANON_KEY|FREECUT_URL|AUDIOMASS_URL)\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
    expect(offenders, `read the baked value directly (use runtimeApiUrl / runtimeSupabaseUrl / runtimeSupabaseAnonKey / runtimeFreecutUrl / runtimeAudiomassUrl): ${offenders.join(", ")}`).toEqual([])
  })
})

describe("runtimeUploadModerationEnabled (G3 — upload-moderation capability gate)", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("is true only when the runtime flag is explicitly true", () => {
    window.__NODARO_RUNTIME__ = { moderation: { uploadImage: true } }
    expect(runtimeUploadModerationEnabled()).toBe(true)
  })

  it("is false when the moderation block is absent (mainline default)", () => {
    expect(runtimeUploadModerationEnabled()).toBe(false)
  })

  it("is false when the flag is present but not true", () => {
    window.__NODARO_RUNTIME__ = { moderation: { uploadImage: false } }
    expect(runtimeUploadModerationEnabled()).toBe(false)
    window.__NODARO_RUNTIME__ = { moderation: {} }
    expect(runtimeUploadModerationEnabled()).toBe(false)
  })
})

describe("runtimePreviewStopRule (the preview stop rule's rollout flag, decided 2026-10-05)", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("is true only when /config.js says exactly true", () => {
    window.__NODARO_RUNTIME__ = { previewStopRule: true }
    expect(runtimePreviewStopRule()).toBe(true)
  })

  it("is false with no /config.js value (a dev server, or production while it is off)", () => {
    expect(runtimePreviewStopRule()).toBe(false)
    window.__NODARO_RUNTIME__ = {}
    expect(runtimePreviewStopRule()).toBe(false)
    window.__NODARO_RUNTIME__ = { previewStopRule: "true" as unknown as boolean }
    expect(runtimePreviewStopRule()).toBe(false)
  })
})

describe("runtimeMediaOrigin (a white-label deployment's media host)", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("returns the https origin /config.js names", () => {
    window.__NODARO_RUNTIME__ = { mediaOrigin: "https://media.example.com" }
    expect(runtimeMediaOrigin()).toBe("https://media.example.com")
  })

  it("is undefined when /config.js names none (every deployment that is not white-label)", () => {
    expect(runtimeMediaOrigin()).toBeUndefined()
    window.__NODARO_RUNTIME__ = {}
    expect(runtimeMediaOrigin()).toBeUndefined()
  })

  it.each(["http://media.example.com", "https://media.example.com/bucket", "media.example.com", ""])("drops a value that is not an https origin (%j)", (value) => {
    window.__NODARO_RUNTIME__ = { mediaOrigin: value }
    expect(runtimeMediaOrigin()).toBeUndefined()
  })

  it("is no value when the key is not a string at all", () => {
    window.__NODARO_RUNTIME__ = { mediaOrigin: 7 as unknown as string }
    expect(runtimeMediaOrigin()).toBeUndefined()
  })
})

/**
 * A deployment that moved its pages to a host of their own: browser calls from
 * that host stay same-origin (it is the same service), the developer-facing
 * link origin is separate, and on every other deployment nothing changes.
 */
describe("runtimeFlowUiOrigin / runtimeIsOnFlowUiHost / runtimeLinkOrigin", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })
  const FLOW = "https://flow.example.test"
  const APP = "https://app.example.test"
  const ON = { apiUrl: APP, flowUiOrigin: FLOW, legacyUiHosts: ["app.example.test"], linkOrigin: APP }

  it("unset: no Flow origin, no link origin, runtimeApiUrl unchanged", () => {
    window.__NODARO_RUNTIME__ = { apiUrl: APP }
    expect(runtimeFlowUiOrigin()).toBe("")
    expect(runtimeLinkOrigin()).toBe("")
    expect(runtimeIsOnFlowUiHost(FLOW)).toBe(false)
    expect(runtimeApiUrl(FLOW)).toBe(APP)
  })

  it("on the Flow host the API is same-origin; on the kept host it stays the kept host", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(runtimeFlowUiOrigin()).toBe(FLOW)
    expect(runtimeLinkOrigin()).toBe(APP)
    expect(runtimeLegacyUiHosts()).toEqual(["app.example.test"])
    expect(runtimeIsOnFlowUiHost(FLOW)).toBe(true)
    expect(runtimeApiUrl(FLOW)).toBe("")
    expect(runtimeApiUrl(APP)).toBe(APP)
  })

  it("the move is on only as the proxy reads it: all three keys, a legacy host that is not the Flow host, a kept origin that is not the Flow origin", () => {
    for (const runtime of [
      { ...ON, legacyUiHosts: undefined },
      { ...ON, legacyUiHosts: ["flow.example.test"] },
      { ...ON, linkOrigin: undefined },
      { ...ON, linkOrigin: FLOW },
      { ...ON, linkOrigin: `${APP}/` },
      { ...ON, flowUiOrigin: "http://flow.example.test" },
    ]) {
      window.__NODARO_RUNTIME__ = runtime
      expect(runtimeFlowUiOrigin(), JSON.stringify(runtime)).toBe("")
      expect(runtimeLinkOrigin(), JSON.stringify(runtime)).toBe("")
      expect(runtimeLegacyUiHosts(), JSON.stringify(runtime)).toEqual([])
      expect(runtimeIsOnFlowUiHost(FLOW), JSON.stringify(runtime)).toBe(false)
      expect(runtimeApiUrl(FLOW), JSON.stringify(runtime)).toBe(APP)
    }
  })

  it("runtimeIsOnMovedHost: the Flow host and the named legacy hosts, never any other host the service answers on", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(runtimeIsOnMovedHost(FLOW)).toBe(true)
    expect(runtimeIsOnMovedHost(APP)).toBe(true)
    expect(runtimeIsOnMovedHost("https://sai.example.test")).toBe(false)
    delete window.__NODARO_RUNTIME__
    expect(runtimeIsOnMovedHost(FLOW)).toBe(false)
  })
})
