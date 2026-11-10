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

// ── The brand in index.html's head (written at boot after /config.js) ────────

import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync as writeFile } from "node:fs"
import { tmpdir } from "node:os"
import { applyBrandHead, brandHeadRequest, indexHtmlPath, isSameSitePath, writeBrandHead } from "../build-runtime-config.mjs"

const SOURCE_INDEX = resolve(dirname(ENTRY), "..", "frontend", "index.html")
const SOURCE_HTML = readFileSync(SOURCE_INDEX, "utf8")

// What `vite build` makes of index.html: the module entry leaves <body>, and
// the hashed bundle, its preloads and the stylesheets land before </head>.
const VITE_TAGS = [
  '    <script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>',
  '    <link rel="modulepreload" crossorigin href="/assets/react-vendor-Ef56Gh78.js">',
  '    <link rel="stylesheet" crossorigin href="/assets/index-Ij90Kl12.css">',
]
const BUILT_HTML = SOURCE_HTML.replace('    <script type="module" src="/src/main.tsx"></script>\n', "").replace("  </head>", `${VITE_TAGS.join("\n")}\n  </head>`)

const BRAND = { productName: "Example Studio", description: "Workflows by Example Studio", favicon: ["/brand/favicon.svg", "/brand/favicon.png"] }

/** The head with the three rewritten anchors taken out, to compare everything else. */
const outsideAnchors = (html) =>
  html
    .split("\n")
    .filter((line) => !/<title>|<meta\b[^>]*name="description"|<link\b[^>]*rel="(?:icon|apple-touch-icon)"/.test(line))
    .join("\n")

function tempIndex(html) {
  const dir = mkdtempSync(resolve(tmpdir(), "brand-head-"))
  const file = resolve(dir, "index.html")
  writeFile(file, html)
  return { dir, file }
}

function runCli(env, indexFile) {
  return spawnSync(process.execPath, [ENTRY, "--index-html", indexFile], { encoding: "utf8", env })
}

test("the built fixture really looks built (sanity for the tests below)", () => {
  assert.ok(BUILT_HTML.includes("/assets/index-Ab12Cd34.js"))
  assert.ok(!BUILT_HTML.includes("/src/main.tsx"))
})

test("INERT: no brand, or the platform's own name, asks nothing of the head and returns the same bytes", () => {
  for (const brand of [undefined, null, {}, { productName: "Nodaro" }, { productName: "Nodaro", description: "" }, { productName: " " }, { favicon: [] }, { favicon: ["//evil.example/x.svg", "https://x.example/y.png"] }, "x", [1]]) {
    assert.equal(brandHeadRequest(brand), undefined, JSON.stringify(brand))
    const out = applyBrandHead(BUILT_HTML, brand)
    assert.equal(out.html, BUILT_HTML, JSON.stringify(brand))
    assert.deepEqual(out.problems, [])
  }
})

test("INERT end to end: with no brand set the CLI never writes index.html — same bytes, same mtime, no log line", () => {
  const { dir, file } = tempIndex(BUILT_HTML)
  try {
    const mtime = statSync(file).mtimeMs
    // No surface at all, and a resolved profile whose brand is the platform default.
    for (const surface of [undefined, JSON.stringify({ nav: { hide: ["gallery"] }, brand: { productName: "Nodaro" } })]) {
      const env = surface === undefined ? {} : { RUNTIME_SURFACE_PROFILE: surface }
      const res = runCli(env, file)
      assert.equal(res.status, 0)
      assert.match(res.stdout, /^window\.__NODARO_RUNTIME__=\{.*\};\n$/)
      assert.doesNotMatch(res.stderr, /brand head/)
    }
    assert.equal(readFileSync(file, "utf8"), BUILT_HTML)
    assert.equal(statSync(file).mtimeMs, mtime)
    assert.deepEqual(readdirSync(dir), ["index.html"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a brand rewrites the title, the description and the icons; every other byte stays as built", () => {
  const { html, applied, problems } = applyBrandHead(BUILT_HTML, BRAND)
  assert.deepEqual(problems, [])
  assert.deepEqual(applied, ["title", "description", "favicon"])
  assert.match(html, /<title>Example Studio<\/title>/)
  assert.match(html, /<meta name="description" content="Workflows by Example Studio" \/>/)
  assert.ok(html.includes('    <link rel="icon" type="image/svg+xml" href="/brand/favicon.svg" />\n    <link rel="icon" type="image/png" href="/brand/favicon.png" />\n'))
  // Every platform icon link is gone, the home-screen one included.
  assert.doesNotMatch(html, /favicon\.svg\?v=11|favicon\.png\?v=11|favicon\.ico\?v=11|apple-touch-icon|logo-192\.png/)
  assert.equal(html.match(/<link\b[^>]*rel="icon"/g).length, 2)
  // Vite's hashed references, byte for byte.
  for (const tag of VITE_TAGS) assert.ok(html.includes(tag), tag)
  assert.equal(outsideAnchors(html), outsideAnchors(BUILT_HTML))
})

test("only the parts the brand sets are touched", () => {
  const { html, applied } = applyBrandHead(BUILT_HTML, { productName: "Nodaro", description: "Workflows by Example Studio" })
  assert.deepEqual(applied, ["description"])
  assert.match(html, /<title>Nodaro\.ai<\/title>/)
  assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=11" />'))
  const titleOnly = applyBrandHead(BUILT_HTML, { productName: "Example Studio" })
  assert.deepEqual(titleOnly.applied, ["title"])
  assert.match(titleOnly.html, /content="Visual workflow platform for AI video generation"/)
})

test("text is escaped for HTML, and $ patterns in it stay literal", () => {
  const { html } = applyBrandHead(BUILT_HTML, { productName: "Example & <Studio> $& $1", description: 'Say "hi" & $\' bye' })
  // `$&` is escaped like any other ampersand; what matters is that it never expanded to the match.
  assert.match(html, /<title>Example &amp; &lt;Studio&gt; \$&amp; \$1<\/title>/)
  assert.ok(html.includes('content="Say &quot;hi&quot; &amp; $\' bye"'))
})

test("icon types come from the extension; an unknown one gets no type", () => {
  const { html } = applyBrandHead(BUILT_HTML, { productName: "Nodaro", favicon: ["/b/i.ico?v=3", "/b/i.webp", "/b/icon"] })
  assert.ok(html.includes('<link rel="icon" type="image/x-icon" href="/b/i.ico?v=3" />'))
  assert.ok(html.includes('<link rel="icon" type="image/webp" href="/b/i.webp" />'))
  assert.ok(html.includes('<link rel="icon" href="/b/icon" />'))
})

test("idempotent: the rewrite of a rewritten head is the same head, whichever brand came first", () => {
  const once = applyBrandHead(BUILT_HTML, BRAND).html
  assert.equal(applyBrandHead(once, BRAND).html, once)
  const other = applyBrandHead(BUILT_HTML, { productName: "Other", description: "Other text", favicon: ["/o.png", "/o.svg", "/o.ico"] }).html
  assert.equal(applyBrandHead(other, BRAND).html, once)
})

test("a missing or doubled anchor leaves the file exactly as built, and says why", () => {
  const cases = [
    [BUILT_HTML.replace(/<title>[^<]*<\/title>/, ""), /<title> found 0 times/],
    [BUILT_HTML.replace("</title>", "</title>\n    <title>Second</title>"), /<title> found 2 times/],
    [BUILT_HTML.replace(/<meta name="description"[^>]*>/, ""), /description"> found 0 times/],
    [BUILT_HTML.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\n/g, ""), /no icon <link>/],
    [BUILT_HTML.replace("</head>", ""), /no <head>…<\/head>/],
  ]
  for (const [html, why] of cases) {
    const out = applyBrandHead(html, BRAND)
    assert.equal(out.html, html)
    assert.deepEqual(out.applied, [])
    assert.match(out.problems.join("; "), why)
  }
})

test("CLI: a brand is written in place, atomically, and logged — stdout is still only /config.js", () => {
  const { dir, file } = tempIndex(BUILT_HTML)
  try {
    const res = runCli({ RUNTIME_SURFACE_PROFILE: JSON.stringify({ brand: BRAND }) }, file)
    assert.equal(res.status, 0)
    assert.match(res.stdout, /^window\.__NODARO_RUNTIME__=\{"surface":\{.*\}\};\n$/)
    assert.match(res.stderr, /brand head applied to .*index\.html: title, description, favicon/)
    assert.equal(readFileSync(file, "utf8"), applyBrandHead(BUILT_HTML, BRAND).html)
    assert.deepEqual(readdirSync(dir), ["index.html"])
    // A second boot of the same container: nothing to change.
    const again = runCli({ RUNTIME_SURFACE_PROFILE: JSON.stringify({ brand: BRAND }) }, file)
    assert.match(again.stderr, /brand head already in/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("CLI: anchors missing → the file stays as built, the reason is logged, /config.js and the exit code are untouched", () => {
  const broken = BUILT_HTML.replace(/<title>[^<]*<\/title>/, "")
  const { dir, file } = tempIndex(broken)
  try {
    const res = runCli({ RUNTIME_SURFACE_PROFILE: JSON.stringify({ brand: BRAND }) }, file)
    assert.equal(res.status, 0)
    assert.match(res.stdout, /^window\.__NODARO_RUNTIME__=/)
    assert.match(res.stderr, /brand head NOT applied: <title> found 0 times/)
    assert.equal(readFileSync(file, "utf8"), broken)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("CLI: an unreadable index.html is logged, never fatal", () => {
  const res = runCli({ RUNTIME_SURFACE_PROFILE: JSON.stringify({ brand: BRAND }) }, "/nonexistent/brand-head/index.html")
  assert.equal(res.status, 0)
  assert.match(res.stdout, /^window\.__NODARO_RUNTIME__=/)
  assert.match(res.stderr, /brand head NOT applied: cannot read/)
})

// The image may leave frontend/dist/ to root while index.html is this user's:
// no temporary file can be created beside it, but the file itself is writable.
test("a directory it cannot write into: the head is written in place, no temp file left", { skip: process.getuid?.() === 0 ? "root ignores the mode bits" : false }, () => {
  const { dir, file } = tempIndex(BUILT_HTML)
  try {
    chmodSync(dir, 0o555)
    const logs = []
    assert.equal(writeBrandHead(file, BRAND, (l) => logs.push(l)), "applied")
    assert.equal(readFileSync(file, "utf8"), applyBrandHead(BUILT_HTML, BRAND).html)
    assert.deepEqual(readdirSync(dir), ["index.html"])
    assert.match(logs.join("\n"), /brand head applied/)
  } finally {
    chmodSync(dir, 0o755)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a file it cannot write either: logged as not applied, the file as built", { skip: process.getuid?.() === 0 ? "root ignores the mode bits" : false }, () => {
  const { dir, file } = tempIndex(BUILT_HTML)
  try {
    chmodSync(file, 0o444)
    chmodSync(dir, 0o555)
    const logs = []
    assert.equal(writeBrandHead(file, BRAND, (l) => logs.push(l)), "failed")
    assert.equal(readFileSync(file, "utf8"), BUILT_HTML)
    assert.match(logs.join("\n"), /brand head NOT applied/)
  } finally {
    chmodSync(dir, 0o755)
    chmodSync(file, 0o644)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("writeBrandHead never throws, even on a path it cannot write", () => {
  const logs = []
  assert.equal(writeBrandHead("/nonexistent/x.html", BRAND, (l) => logs.push(l)), "unreadable")
  assert.equal(writeBrandHead("/nonexistent/x.html", undefined, (l) => logs.push(l)), "inert")
  assert.equal(logs.length, 1)
})

test("the default index.html is the image's layout: tools/ beside frontend/dist/", () => {
  assert.equal(indexHtmlPath([]), resolve(dirname(ENTRY), "..", "frontend", "dist", "index.html"))
  assert.equal(indexHtmlPath(["--index-html", "/x/index.html"]), "/x/index.html")
  assert.equal(indexHtmlPath(["--index-html=/y/index.html"]), "/y/index.html")
})

test("GUARD: frontend/index.html still has every anchor the boot rewrite needs (an edit that loses one fails here)", () => {
  assert.deepEqual(applyBrandHead(SOURCE_HTML, BRAND).problems, [])
  assert.deepEqual(applyBrandHead(BUILT_HTML, BRAND).problems, [])
})

test("isSameSitePath: a path on this site, nothing that could leave it or end an attribute", () => {
  for (const ok of ["/brand/favicon.svg", "/icon.png?v=2"]) assert.equal(isSameSitePath(ok), true, ok)
  for (const bad of ["//x.example/a.svg", "/\\x.example/a.svg", "https://x.example/a.svg", "a.svg", '/a".svg', "/a<b>.svg", "/a b.svg", "", 7, undefined]) {
    assert.equal(isSameSitePath(bad), false, String(bad))
  }
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

test("the moved-pages keys exist exactly when the proxy's half is on, all three together", () => {
  const on = { RUNTIME_FLOW_UI_ORIGIN: "https://flow.example.com", RUNTIME_LEGACY_UI_HOSTS: "app.example.com, next.app.example.com", RUNTIME_LINK_ORIGIN: "https://app.example.com" }
  const cfg = buildRuntimeConfig(on)
  assert.equal(cfg.flowUiOrigin, "https://flow.example.com")
  assert.deepEqual(cfg.legacyUiHosts, ["app.example.com", "next.app.example.com"])
  assert.equal(cfg.linkOrigin, "https://app.example.com")
  const none = (env) => {
    const c = buildRuntimeConfig(env)
    return !("flowUiOrigin" in c) && !("legacyUiHosts" in c) && !("linkOrigin" in c)
  }
  // PUBLIC_URL alone (the usual case), FLOW_UI_ORIGIN alone, or hosts alone: nothing.
  assert.ok(none({ RUNTIME_LINK_ORIGIN: "https://app.example.com" }))
  assert.ok(none({ RUNTIME_FLOW_UI_ORIGIN: "https://flow.example.com", RUNTIME_LINK_ORIGIN: "https://app.example.com" }))
  assert.ok(none({ RUNTIME_LEGACY_UI_HOSTS: "app.example.com" }))
  // What the Caddy block refuses, the browser never acts on either.
  assert.ok(none({ ...on, RUNTIME_FLOW_UI_ORIGIN: "http://flow.example.com" }))
  assert.ok(none({ ...on, RUNTIME_FLOW_UI_ORIGIN: " https://flow.example.com" }))
  assert.ok(none({ ...on, RUNTIME_FLOW_UI_ORIGIN: "https://flow.example.com/x" }))
  assert.ok(none({ ...on, RUNTIME_LEGACY_UI_HOSTS: "flow.example.com" }))
  // With no kept origin to name, the move never turns on in the browser: no public link may name the Flow host
  // (and the server refuses to start in this state: backend/src/lib/moved-pages-settings.ts).
  assert.ok(none({ ...on, RUNTIME_LINK_ORIGIN: "" }))
  assert.ok(none({ ...on, RUNTIME_LINK_ORIGIN: "http://app.example.com" }))
  assert.ok(none({ ...on, RUNTIME_LINK_ORIGIN: "https://app.example.com/v1" }))
  assert.ok(none({ ...on, RUNTIME_LINK_ORIGIN: "https://flow.example.com/" }))
  assert.deepEqual(Object.keys(buildRuntimeConfig({})), [])
})

test("both origins are read as the proxy reads them: a trailing slash is allowed and dropped", () => {
  const cfg = buildRuntimeConfig({ RUNTIME_FLOW_UI_ORIGIN: "https://flow.example.com/", RUNTIME_LEGACY_UI_HOSTS: "app.example.com", RUNTIME_LINK_ORIGIN: "https://app.example.com/" })
  assert.equal(cfg.flowUiOrigin, "https://flow.example.com")
  assert.equal(cfg.linkOrigin, "https://app.example.com")
})

test("the host list is split by the proxy's one rule: commas are spaces, runs of spaces separate, letter case is ignored", () => {
  const cfg = buildRuntimeConfig({ RUNTIME_FLOW_UI_ORIGIN: "https://flow.example.com", RUNTIME_LEGACY_UI_HOSTS: " App.Example.com,,Next.app.example.com  flow.example.com ", RUNTIME_LINK_ORIGIN: "https://app.example.com" })
  assert.deepEqual(cfg.legacyUiHosts, ["app.example.com", "next.app.example.com", "flow.example.com"])
})

test("CLI entry: a move it cannot turn on says why, on stderr, and writes the rest of /config.js", () => {
  const res = spawnSync(process.execPath, [ENTRY], {
    encoding: "utf8",
    env: { ...NODARO_DEPLOYMENT_ENV, RUNTIME_FLOW_UI_ORIGIN: "https://flow.example.com", RUNTIME_LEGACY_UI_HOSTS: "app.nodaro.ai", RUNTIME_LINK_ORIGIN: "http://localhost:3000" },
  })
  assert.equal(res.status, 0)
  assert.equal(res.stdout, NODARO_CONFIG_JS)
  assert.match(res.stderr, /PUBLIC_URL/)
})

test("start.sh names the settings the moved-pages keys come from", () => {
  const dockerfile = readFileSync(resolve(dirname(ENTRY), "..", "Dockerfile"), "utf8")
  const writerCall = dockerfile.slice(dockerfile.indexOf("RUNTIME_API_URL=\"$RUNTIME_API_URL_EFFECTIVE\""))
  const line = writerCall.slice(0, writerCall.indexOf("build-runtime-config.mjs"))
  assert.match(line, /RUNTIME_FLOW_UI_ORIGIN="\$FLOW_UI_ORIGIN"/)
  assert.match(line, /RUNTIME_LEGACY_UI_HOSTS="\$LEGACY_UI_HOSTS"/)
  assert.match(line, /RUNTIME_LINK_ORIGIN="\$PUBLIC_URL"/)
})

test("CLI entry: with the move's settings blank, /config.js is byte-identical", () => {
  assert.equal(configJs({ ...NODARO_DEPLOYMENT_ENV, RUNTIME_FLOW_UI_ORIGIN: "", RUNTIME_LEGACY_UI_HOSTS: "", RUNTIME_LINK_ORIGIN: "https://app.nodaro.ai" }), NODARO_CONFIG_JS)
})
