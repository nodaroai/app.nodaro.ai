import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
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

// "/" is the same-origin SENTINEL start.sh emits for
// PUBLIC_URL_SAME_ORIGIN=true. It must survive `pick` verbatim: it is a real
// value, not a blank, and the frontend reads exactly "/" as "same origin"
// (runtime-config.ts) while an EMPTY apiUrl means "no override" and would fall
// back to the baked VITE_API_URL — the one value a multi-hostname studio must
// not use.
test('the same-origin sentinel "/" passes through as apiUrl', () => {
  const cfg = buildRuntimeConfig({ RUNTIME_API_URL: "/" })
  assert.equal(cfg.apiUrl, "/")
})

test("a blank RUNTIME_API_URL is still no override at all", () => {
  assert.ok(!("apiUrl" in buildRuntimeConfig({ RUNTIME_API_URL: "  " })))
  assert.ok(!("apiUrl" in buildRuntimeConfig({})))
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

// SAI-3 / H10: the writer no longer gates by edition or reads an @file — the
// backend printer (backend/src/lib/print-surface-profile.ts) already applied the
// gate and resolved the file, and hands over "" when the browser should inherit
// its code default. These pin that the writer stays a verbatim pass-through, so
// a second parser can never grow back here.
test("no edition gate here: the surface passes through regardless of EDITION", () => {
  const cfg = buildRuntimeConfig({
    EDITION: "community",
    RUNTIME_SURFACE_PROFILE: JSON.stringify({ nav: { hide: ["gallery"] } }),
  })
  assert.deepEqual(cfg.surface.nav.hide, ["gallery"])
})

test("passes the resolved profile through verbatim — every key, unknown ones included", () => {
  const resolved = { nav: { hide: ["pricing"] }, billing: { unitLabel: "קרדיטים", unitRate: 2000 }, future: { k: 1 } }
  const cfg = buildRuntimeConfig({ EDITION: "cloud", RUNTIME_SURFACE_PROFILE: JSON.stringify(resolved) })
  assert.deepEqual(cfg.surface, resolved)
})

test("an @file reference is NOT read here (the printer resolved it) → treated as not-JSON, no surface key", () => {
  const cfg = buildRuntimeConfig({ EDITION: "cloud", RUNTIME_SURFACE_PROFILE: "@/etc/passwd" })
  assert.ok(!("surface" in cfg))
})

test("a JSON array or scalar is not a profile → no surface key", () => {
  assert.ok(!("surface" in buildRuntimeConfig({ RUNTIME_SURFACE_PROFILE: "[1,2]" })))
  assert.ok(!("surface" in buildRuntimeConfig({ RUNTIME_SURFACE_PROFILE: "42" })))
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

// The preview stop rule's rollout flag (decided 2026-10-05) reaches the editor
// through /config.js, from the SAME variable the backend reads
// (PREVIEW_STOP_RULE_ENABLED), with the same strict parse — so the editor and
// the server can never disagree, and flipping it needs no rebuild.
test("RUNTIME_PREVIEW_STOP_RULE true / 1 → previewStopRule true", () => {
  assert.equal(buildRuntimeConfig({ RUNTIME_PREVIEW_STOP_RULE: "true" }).previewStopRule, true)
  assert.equal(buildRuntimeConfig({ RUNTIME_PREVIEW_STOP_RULE: "1" }).previewStopRule, true)
})

test("an unset / falsey RUNTIME_PREVIEW_STOP_RULE leaves no key (production's /config.js is unchanged)", () => {
  for (const value of [undefined, "", "false", "0", "TRUE", "yes"]) {
    assert.ok(!("previewStopRule" in buildRuntimeConfig({ RUNTIME_PREVIEW_STOP_RULE: value })), String(value))
  }
})

test("start.sh hands PREVIEW_STOP_RULE_ENABLED to the writer", () => {
  const dockerfile = readFileSync(resolve(dirname(ENTRY), "..", "Dockerfile"), "utf8")
  const writerCall = dockerfile.slice(dockerfile.indexOf("RUNTIME_API_URL=\"$RUNTIME_API_URL_EFFECTIVE\""))
  assert.match(writerCall.slice(0, writerCall.indexOf("build-runtime-config.mjs")), /RUNTIME_PREVIEW_STOP_RULE="\$PREVIEW_STOP_RULE_ENABLED"/)
})

// The deployment's media origin. The backend decides it — "" except on a
// white-label surface (print-surface-profile.js --media-origin, covered in
// backend/src/lib/__tests__/print-surface-profile.test.ts) — and start.sh hands
// the answer over, so the writer only carries it. A blank is no key.
test("RUNTIME_MEDIA_ORIGIN lands on mediaOrigin", () => {
  assert.equal(buildRuntimeConfig({ RUNTIME_MEDIA_ORIGIN: "https://media.example.com" }).mediaOrigin, "https://media.example.com")
})

test("a blank RUNTIME_MEDIA_ORIGIN leaves no key (every deployment that is not white-label)", () => {
  for (const value of [undefined, "", "   "]) {
    assert.ok(!("mediaOrigin" in buildRuntimeConfig({ RUNTIME_MEDIA_ORIGIN: value })), String(value))
  }
})

test("start.sh asks the backend for the media origin and hands it to the writer", () => {
  const dockerfile = readFileSync(resolve(dirname(ENTRY), "..", "Dockerfile"), "utf8")
  assert.match(
    dockerfile,
    /RUNTIME_MEDIA_ORIGIN_RESOLVED="\$\(node \/app\/backend\/dist\/lib\/print-surface-profile\.js --media-origin\)" \|\| RUNTIME_MEDIA_ORIGIN_RESOLVED=""/,
  )
  const writerCall = dockerfile.slice(dockerfile.indexOf("RUNTIME_API_URL=\"$RUNTIME_API_URL_EFFECTIVE\""))
  assert.match(writerCall.slice(0, writerCall.indexOf("build-runtime-config.mjs")), /RUNTIME_MEDIA_ORIGIN="\$RUNTIME_MEDIA_ORIGIN_RESOLVED"/)
})

// What start.sh passes on Nodaro's own deployments: the API URL, the anon key,
// and every other input blank (no surface profile, so the backend's media-origin
// answer is blank too).
const NODARO_DEPLOYMENT_ENV = {
  RUNTIME_API_URL: "https://app.nodaro.ai",
  RUNTIME_SUPABASE_URL: "",
  RUNTIME_SUPABASE_ANON_KEY: "public-anon-key",
  RUNTIME_FREECUT_URL: "",
  RUNTIME_AUDIOMASS_URL: "",
  RUNTIME_DEFAULT_LOCALE: "",
  RUNTIME_SURFACE_PROFILE: "",
  RUNTIME_PREVIEW_STOP_RULE: "",
}
// The exact bytes the writer printed for that environment BEFORE this key existed.
const NODARO_CONFIG_JS = 'window.__NODARO_RUNTIME__={"apiUrl":"https://app.nodaro.ai","supabaseAnonKey":"public-anon-key"};\n'
const configJs = (env) => spawnSync(process.execPath, [ENTRY], { encoding: "utf8", env }).stdout

test("CLI entry: Nodaro's own /config.js is byte-identical", () => {
  assert.equal(configJs(NODARO_DEPLOYMENT_ENV), NODARO_CONFIG_JS)
  assert.equal(configJs({ ...NODARO_DEPLOYMENT_ENV, RUNTIME_MEDIA_ORIGIN: "" }), NODARO_CONFIG_JS)
})

test("CLI entry: a white-label deployment gets exactly one more key, after every existing byte", () => {
  assert.equal(
    configJs({ ...NODARO_DEPLOYMENT_ENV, RUNTIME_MEDIA_ORIGIN: "https://media.example.com" }),
    'window.__NODARO_RUNTIME__={"apiUrl":"https://app.nodaro.ai","supabaseAnonKey":"public-anon-key","mediaOrigin":"https://media.example.com"};\n',
  )
})
