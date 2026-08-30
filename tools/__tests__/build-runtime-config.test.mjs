import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { buildRuntimeConfig } from "../build-runtime-config.mjs"

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build-runtime-config.mjs")

test("carries the A3 trio + locale, omitting absent keys", () => {
  const cfg = buildRuntimeConfig({ RUNTIME_API_URL: "https://x.test", RUNTIME_DEFAULT_LOCALE: "he" })
  assert.equal(cfg.apiUrl, "https://x.test")
  assert.equal(cfg.defaultLocale, "he")
  assert.ok(!("supabaseUrl" in cfg))
})

test("carries the editor URLs (freecut + audiomass), omitting absent ones", () => {
  const cfg = buildRuntimeConfig({ RUNTIME_FREECUT_URL: "https://fc.test", RUNTIME_AUDIOMASS_URL: "https://am.test" })
  assert.equal(cfg.freecutUrl, "https://fc.test")
  assert.equal(cfg.audiomassUrl, "https://am.test")
  assert.ok(!("audiomassUrl" in buildRuntimeConfig({ RUNTIME_FREECUT_URL: "https://fc.test" })))
})

test("parses an inline surface JSON into cfg.surface", () => {
  const cfg = buildRuntimeConfig({
    EDITION: "business",
    RUNTIME_SURFACE_PROFILE: JSON.stringify({ nav: { hide: ["gallery"] }, brand: { productName: "SAI" } }),
  })
  assert.deepEqual(cfg.surface.nav.hide, ["gallery"])
  assert.equal(cfg.surface.brand.productName, "SAI")
})

test("blank surface env → no surface key (frontend then uses its own default)", () => {
  const cfg = buildRuntimeConfig({ EDITION: "business", RUNTIME_SURFACE_PROFILE: "" })
  assert.ok(!("surface" in cfg))
})

test("malformed surface JSON → no surface key, never throws", () => {
  assert.doesNotThrow(() => buildRuntimeConfig({ EDITION: "business", RUNTIME_SURFACE_PROFILE: "{ bad" }))
  const cfg = buildRuntimeConfig({ EDITION: "business", RUNTIME_SURFACE_PROFILE: "{ bad" })
  assert.ok(!("surface" in cfg))
})

test("d2 gate: community edition drops the surface (business+ only)", () => {
  // Keep this in lock-step with surfaceGateOpenForEdition's body (d2, Branch B).
  const cfg = buildRuntimeConfig({
    EDITION: "community",
    RUNTIME_SURFACE_PROFILE: JSON.stringify({ nav: { hide: ["gallery"] } }),
  })
  assert.ok(!("surface" in cfg))
})

test("d2 gate: cloud edition honours the surface", () => {
  const cfg = buildRuntimeConfig({
    EDITION: "cloud",
    RUNTIME_SURFACE_PROFILE: JSON.stringify({ nav: { hide: ["pricing"] } }),
  })
  assert.deepEqual(cfg.surface.nav.hide, ["pricing"])
})

// BLOCKER 1 — the degrade notice for a malformed surface profile MUST go to
// stderr, not stdout: start.sh redirects this entry's stdout verbatim into
// /config.js, so any stdout log line corrupts the `window.__NODARO_RUNTIME__=…;`
// assignment and takes ALL runtime config down. Unit tests over buildRuntimeConfig
// never saw it because the log lives in the CLI entry's parse path — this spawns
// the real entry and asserts stdout is EXACTLY the assignment line.
test("CLI entry: malformed surface JSON never leaks a log line into stdout (config.js)", () => {
  const res = spawnSync(process.execPath, [ENTRY], {
    encoding: "utf8",
    // Minimal env so stdout is deterministic (no inherited RUNTIME_* keys).
    env: { EDITION: "business", RUNTIME_SURFACE_PROFILE: "{ not valid json" },
  })
  assert.equal(res.status, 0)
  // stdout goes straight into /config.js — it must be ONLY the assignment line.
  assert.equal(res.stdout, "window.__NODARO_RUNTIME__={};\n")
  // The degrade notice belongs on stderr (which the Dockerfile does NOT redirect).
  assert.match(res.stderr, /surface profile ignored/)
})

test("RUNTIME_UPLOAD_MODERATION=true → moderation.uploadImage true", () => {
  const cfg = buildRuntimeConfig({ RUNTIME_UPLOAD_MODERATION: "true" })
  assert.deepEqual(cfg.moderation, { uploadImage: true })
})

test("moderation flag is edition-independent (community may wire it)", () => {
  const cfg = buildRuntimeConfig({ EDITION: "community", RUNTIME_UPLOAD_MODERATION: "true" })
  assert.deepEqual(cfg.moderation, { uploadImage: true })
})

test("absent / falsey RUNTIME_UPLOAD_MODERATION → no moderation key (mainline inert)", () => {
  assert.ok(!("moderation" in buildRuntimeConfig({})))
  assert.ok(!("moderation" in buildRuntimeConfig({ RUNTIME_UPLOAD_MODERATION: "" })))
  assert.ok(!("moderation" in buildRuntimeConfig({ RUNTIME_UPLOAD_MODERATION: "false" })))
})
