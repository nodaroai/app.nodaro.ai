// @test-watches frontend/src/lib/i18n/en.{ts,js} frontend/src/lib/i18n/platform-languages.{ts,js}
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildUiStringManifest, uiStringManifestFile } from "@nodaro/shared/runtime-config"
import { en } from "../../../../frontend/src/lib/i18n/en.js"
import { PLATFORM_LANGUAGES } from "../../../../frontend/src/lib/i18n/platform-languages.js"
import { config } from "../config.js"
import { runtimeSurfaceProfile, __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { renderMediaOriginForRuntimeConfig, renderSurfaceProfileForRuntimeConfig } from "../surface-profile-runtime-config.js"

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
  brand: { productName: "Acme Studio" },
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
    expect(parsed.brand.productName).toBe("Acme Studio")
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

describe("renderMediaOriginForRuntimeConfig — only a white-label surface names its media host", () => {
  const WHITE_LABEL = JSON.stringify({ header: "white-label" })
  const REAL_MEDIA_URL = config.R2_PUBLIC_URL
  afterEach(() => {
    config.R2_PUBLIC_URL = REAL_MEDIA_URL
  })

  it("a white-label surface: the https origin of the public media URL, any path dropped", () => {
    config.EDITION = "business"
    setEnv(WHITE_LABEL)
    for (const url of ["https://media.acme.example", "https://media.acme.example/", "https://media.acme.example/bucket/path"]) {
      config.R2_PUBLIC_URL = url
      expect(renderMediaOriginForRuntimeConfig()).toBe("https://media.acme.example")
    }
    config.R2_PUBLIC_URL = "https://media.acme.example:8443/bucket"
    expect(renderMediaOriginForRuntimeConfig()).toBe("https://media.acme.example:8443")
  })

  it("a set header other than the two modes reads as white-label here too (the schema's own rule)", () => {
    config.EDITION = "cloud"
    config.R2_PUBLIC_URL = "https://media.acme.example"
    setEnv(JSON.stringify({ header: "minimal" }))
    expect(renderMediaOriginForRuntimeConfig()).toBe("https://media.acme.example")
  })

  it.each(["", "http://localhost:3000/storage/nodaro-assets", "http://media.acme.example", "media.acme.example", "not a url"])(
    "a media URL that is not https (%j) names no origin",
    (url) => {
      config.EDITION = "cloud"
      config.R2_PUBLIC_URL = url
      setEnv(WHITE_LABEL)
      expect(renderMediaOriginForRuntimeConfig()).toBe("")
    },
  )

  // Nodaro's own /config.js stays byte-identical: whatever its media URL is, its
  // surface is not white-label, so the backend answers "" and the writer adds nothing.
  it.each([
    ["no profile", undefined],
    ["a blank profile", "   "],
    ["a profile that says nothing about the header", JSON.stringify({ nav: { hide: ["gallery"] } })],
    ['header "default"', JSON.stringify({ header: "default" })],
  ])("%s: nothing, whatever the media URL", (_label, profile) => {
    config.EDITION = "cloud"
    config.R2_PUBLIC_URL = "https://assets.nodaro.ai"
    setEnv(profile)
    expect(renderMediaOriginForRuntimeConfig()).toBe("")
  })

  it("community: nothing, even with a white-label profile (the gate is closed)", () => {
    config.EDITION = "community"
    config.R2_PUBLIC_URL = "https://media.acme.example"
    setEnv(WHITE_LABEL)
    expect(renderMediaOriginForRuntimeConfig()).toBe("")
  })

  it("a configured profile that fails to load: nothing", () => {
    config.EDITION = "business"
    config.R2_PUBLIC_URL = "https://media.acme.example"
    setEnv("{ not json")
    expect(renderMediaOriginForRuntimeConfig()).toBe("")
  })
})

describe("print-surface-profile CLI — stdout is exactly the payload", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const CLI = resolve(HERE, "..", "print-surface-profile.ts")
  const BACKEND = resolve(HERE, "..", "..", "..")

  function run(extra: Record<string, string>, args: readonly string[] = []) {
    return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
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
    expect(parsed.brand.productName).toBe("Acme Studio")
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

  describe("UI-string overrides at boot", () => {
    const KEY = "credits.allowanceExceeded"
    const TEXT = "Your Example Studio allowance is used up."
    const PROFILE = JSON.stringify({ ...AUTHORED, strings: { flow: { en: { [KEY]: TEXT, "no.such.key": "x" } } } })
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "print-surface-profile-"))
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it("checks them against the file the build emitted, and prints only what passed", () => {
      writeFileSync(join(dir, uiStringManifestFile("flow")), JSON.stringify(buildUiStringManifest("flow", en, PLATFORM_LANGUAGES)))
      const res = run({ EDITION: "business", NODARO_SURFACE_PROFILE: PROFILE }, ["--ui-strings-dir", dir])
      expect(res.status).toBe(0)
      expect(JSON.parse(res.stdout).strings).toEqual({ flow: { en: { [KEY]: TEXT } } })
      expect(res.stderr).toMatch(/strings\.flow\.en\."no\.such\.key" dropped/)
    }, 60_000)

    it("a build with no manifest still boots: every override dropped, loudly on stderr, the rest of the profile printed", () => {
      const res = run({ EDITION: "business", NODARO_SURFACE_PROFILE: PROFILE }, ["--ui-strings-dir", dir])
      expect(res.status).toBe(0)
      expect(res.stdout).toBe(JSON.stringify(JSON.parse(res.stdout)))
      const parsed = JSON.parse(res.stdout)
      expect(parsed).not.toHaveProperty("strings")
      expect(parsed.nav.hide).toEqual(["gallery"])
      expect(res.stderr).toMatch(/\[surface-profile\] strings\.flow: every override dropped — there is no key manifest at /)
    }, 60_000)

    it("with no strings key it never looks for the file", () => {
      const res = run({ EDITION: "business", NODARO_SURFACE_PROFILE: JSON.stringify(AUTHORED) }, ["--ui-strings-dir", dir])
      expect(res.status).toBe(0)
      expect(res.stderr).not.toMatch(/key manifest/)
    }, 60_000)
  })

  it("--media-origin prints exactly the origin on a white-label surface, and nothing else", () => {
    const res = run({ EDITION: "business", NODARO_SURFACE_PROFILE: JSON.stringify({ header: "white-label" }), R2_PUBLIC_URL: "https://media.acme.example/bucket" }, ["--media-origin"])
    expect(res.status).toBe(0)
    expect(res.stdout).toBe("https://media.acme.example")
  })

  it("--media-origin prints nothing on a deployment that is not white-label, whatever its media URL", () => {
    for (const profile of [undefined, JSON.stringify({ header: "default" })]) {
      const res = run({ EDITION: "cloud", R2_PUBLIC_URL: "https://assets.nodaro.ai", ...(profile ? { NODARO_SURFACE_PROFILE: profile } : {}) }, ["--media-origin"])
      expect(res.status).toBe(0)
      expect(res.stdout).toBe("")
    }
  })
})

describe("renderSurfaceProfileForRuntimeConfig — payerAccount redaction (deployment-payer item 9)", () => {
  it("billing.payerAccount NEVER reaches the browser; everything else renders resolved", () => {
    config.EDITION = "business"
    setEnv(
      JSON.stringify({
        ...AUTHORED,
        billing: { sidebarCard: "hidden", payerAccount: "billing@acme.example" },
      }),
    )

    const backendProfile = runtimeSurfaceProfile()
    // The backend KEEPS the key (deployment-payer boot reads it)…
    expect(backendProfile.billing.payerAccount).toBe("billing@acme.example")

    const out = renderSurfaceProfileForRuntimeConfig()
    // …and the render strips it — by key AND by value (an email in
    // /config.js is the leak this pin exists to prevent).
    expect(out).not.toContain("payerAccount")
    expect(out).not.toContain("billing@acme.example")
    const parsed = JSON.parse(out)
    expect(parsed.billing.sidebarCard).toBe("hidden") // the rest of billing survives
    const { payerAccount: _stripped, ...restBilling } = backendProfile.billing
    expect(parsed).toEqual({ ...backendProfile, billing: restBilling })
  })
})
