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
import { runtimeApiUrl, runtimeDefaultLocale, runtimeSupabaseAnonKey, runtimeSupabaseUrl, runtimeUploadModerationEnabled } from "../runtime-config"

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

describe("runtime-config getters", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("prefer the runtime override when present and non-empty", () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "http://localhost:3010", supabaseUrl: "http://localhost:3010/supabase", supabaseAnonKey: "anon-runtime" }
    expect(runtimeApiUrl()).toBe("http://localhost:3010")
    expect(runtimeSupabaseUrl()).toBe("http://localhost:3010/supabase")
    expect(runtimeSupabaseAnonKey()).toBe("anon-runtime")
  })

  it("fall back to the build-time value when the override is missing or blank", () => {
    window.__NODARO_RUNTIME__ = { apiUrl: "  ", supabaseUrl: "" }
    expect(runtimeApiUrl()).toBe(import.meta.env.VITE_API_URL ?? "")
    expect(runtimeSupabaseUrl()).toBe(import.meta.env.VITE_SUPABASE_URL ?? "")
    delete window.__NODARO_RUNTIME__
    expect(runtimeSupabaseAnonKey()).toBe(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "")
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
