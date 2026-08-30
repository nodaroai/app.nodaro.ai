import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "../config.js"
import { runtimeSurfaceProfile, __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { renderSurfaceProfileForRuntimeConfig } from "../surface-profile-runtime-config.js"

/**
 * SAI-3 / H10 — one parser for the surface profile, by construction.
 *
 * The browser must receive the profile the BACKEND resolved (gate → Zod →
 * merge → refine), never the raw env. The first block pins the render
 * function; the second spawns the real CLI the container's start.sh runs and
 * asserts stdout is EXACTLY the payload — a stray line there (dotenv's
 * banner, a log) lands in /config.js and takes every runtime override down.
 */

const REAL_EDITION = config.EDITION
const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

// "bogus" is not a NavKey (schema drops it); "sso" without ssoLabel is refined
// away; outputs/locale/… are absent (merged in from the default). A verbatim
// copy of this object would fail every assertion below — that is the point.
const AUTHORED = {
  nav: { hide: ["gallery", "bogus"] },
  brand: { productName: "SAI Studio" },
  auth: { methods: ["sso"] },
}

function setEnv(value: string | undefined): void {
  if (value === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = value
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => __resetSurfaceProfileCacheForTests())
afterEach(() => {
  config.EDITION = REAL_EDITION
  setEnv(REAL_ENV)
})

describe("renderSurfaceProfileForRuntimeConfig — the browser gets the RESOLVED profile", () => {
  it("prints what runtimeSurfaceProfile() serves: validated, merged over the default, refined", () => {
    config.EDITION = "business"
    setEnv(JSON.stringify(AUTHORED))

    const out = renderSurfaceProfileForRuntimeConfig()
    const parsed = JSON.parse(out)

    expect(parsed).toEqual(runtimeSurfaceProfile())
    expect(parsed.nav.hide).toEqual(["gallery"]) // the unknown key never reaches the browser
    expect(parsed.auth.methods).toEqual([]) // refineSurfaceEdition applied (sso without a label)
    expect(parsed.outputs).toEqual({ allowPublic: true }) // full shape: defaults merged in
    expect(parsed.brand.productName).toBe("SAI Studio")
  })

  it('is "" when nothing is configured (the browser inherits its code default)', () => {
    config.EDITION = "business"
    setEnv(undefined)
    expect(renderSurfaceProfileForRuntimeConfig()).toBe("")
    setEnv("   ")
    expect(renderSurfaceProfileForRuntimeConfig()).toBe("")
  })

  it('is "" on community — the env is ignored there (d2), exactly as the backend ignores it', () => {
    config.EDITION = "community"
    setEnv(JSON.stringify(AUTHORED))
    expect(renderSurfaceProfileForRuntimeConfig()).toBe("")
  })

  it('is "" when a configured profile fails to load — never "{}" and never the raw text', () => {
    config.EDITION = "business"
    setEnv("{ not json")
    expect(renderSurfaceProfileForRuntimeConfig()).toBe("")
  })
})

describe("print-surface-profile CLI — stdout is exactly the payload", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const CLI = resolve(HERE, "..", "print-surface-profile.ts")
  const BACKEND = resolve(HERE, "..", "..", "..")

  function run(extra: Record<string, string>) {
    return spawnSync(process.execPath, ["--import", "tsx", CLI], {
      cwd: BACKEND,
      encoding: "utf8",
      // Minimal env: what config.ts hard-requires, nothing inherited (no
      // DOTENV_CONFIG_QUIET — the CLI must set that itself; with a local
      // backend/.env present that is what keeps dotenv's banner off stdout).
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-key",
        INTERNAL_ORCHESTRATOR_SECRET: "0".repeat(64),
        ...extra,
      },
    })
  }

  it("prints exactly one JSON document on a gated edition — no banner, no log line, no newline", () => {
    const res = run({ EDITION: "business", NODARO_SURFACE_PROFILE: JSON.stringify(AUTHORED) })
    expect(res.status).toBe(0)
    // Exactly the serialized document and nothing else: re-serializing what we
    // parsed must reproduce stdout byte-for-byte.
    expect(res.stdout).toBe(JSON.stringify(JSON.parse(res.stdout)))
    const parsed = JSON.parse(res.stdout)
    expect(parsed.nav.hide).toEqual(["gallery"])
    expect(parsed.auth.methods).toEqual([])
    expect(parsed.brand.productName).toBe("SAI Studio")
  })

  it("prints nothing at all when nothing is configured", () => {
    const res = run({ EDITION: "business" })
    expect(res.status).toBe(0)
    expect(res.stdout).toBe("")
  })

  it("prints nothing on community", () => {
    const res = run({ EDITION: "community", NODARO_SURFACE_PROFILE: JSON.stringify(AUTHORED) })
    expect(res.status).toBe(0)
    expect(res.stdout).toBe("")
  })
})
