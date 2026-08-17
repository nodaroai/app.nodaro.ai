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
import { runtimeApiUrl, runtimeSupabaseAnonKey, runtimeSupabaseUrl } from "../runtime-config"

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
  it("every VITE_API_URL / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY read goes through runtime-config.ts", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join("lib", "runtime-config.ts")))
      .filter((f) => /import\.meta\.env\.VITE_(API_URL|SUPABASE_URL|SUPABASE_ANON_KEY)\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
    expect(offenders, `read the baked value directly (use runtimeApiUrl / runtimeSupabaseUrl / runtimeSupabaseAnonKey): ${offenders.join(", ")}`).toEqual([])
  })
})
