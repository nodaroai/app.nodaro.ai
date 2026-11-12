// Standalone (no TS import): builds window.__NODARO_RUNTIME__ for /config.js at
// container boot, then writes the deployment's brand into index.html's head.
//
// SELF-CONTAINED ON PURPOSE: the image copies this one file (Dockerfile step
// 7b), so it may import only Node built-ins. A sibling module it imported
// would be missing in the image, and the import error would leave /config.js
// empty on every install.
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const pick = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
/**
 * An https origin read exactly as frontend/Caddyfile's page-homes block reads
 * one (tools/gen-route-homes.mjs): the whole value, a trailing slash allowed
 * and dropped, no path, no port, no spaces around it. Else undefined.
 */
function proxyOrigin(value) {
  const match = typeof value === "string" ? /^(https:\/\/[a-z0-9.-]+)\/?$/.exec(value) : null
  return match ? match[1] : undefined
}

/** LEGACY_UI_HOSTS by the proxy's one rule: ASCII letter case ignored, commas are spaces, runs of spaces separate. */
function legacyHostList(value) {
  const lower = (typeof value === "string" ? value : "").replace(/[A-Z]/g, (letter) => letter.toLowerCase())
  return lower.replace(/,/g, " ").split(" ").filter((host) => host !== "")
}

/**
 * The keys of a deployment whose pages have a host of their own, by the
 * proxy's two rules (tools/gen-route-homes.mjs). flowUiOrigin and linkOrigin
 * exactly when the pages have their own host (a Flow origin, and PUBLIC_URL a
 * kept origin that is not it): a page on the Flow host then carries a
 * browser's saved settings over. legacyUiHosts too exactly when the move is on
 * (a legacy host that is not the Flow host): only then does the browser send a
 * legacy host's pages home, call the API same-origin on the Flow host, or name
 * linkOrigin in public links, so it never acts where the proxy does not.
 * `problem` says why a Flow host that is asked for stays off: the server
 * refuses to start in that state too (backend/src/lib/moved-pages-settings.ts).
 */
export function movedPages(env) {
  const flow = proxyOrigin(env.RUNTIME_FLOW_UI_ORIGIN)
  if (!flow) return { keys: {} }
  const link = proxyOrigin(env.RUNTIME_LINK_ORIGIN)
  if (!link || link === flow) {
    return { keys: {}, problem: "PUBLIC_URL is not an https origin other than FLOW_UI_ORIGIN's, so the browser leaves the app's pages where they are" }
  }
  const hosts = legacyHostList(env.RUNTIME_LEGACY_UI_HOSTS)
  const moved = hosts.some((host) => `https://${host}` !== flow)
  return { keys: moved ? { flowUiOrigin: flow, legacyUiHosts: hosts, linkOrigin: link } : { flowUiOrigin: flow, linkOrigin: link } }
}

/**
 * The surface block is a VERBATIM pass-through (SAI-3 / H10). RUNTIME_SURFACE_PROFILE
 * is no longer the operator's NODARO_SURFACE_PROFILE env: start.sh fills it from
 * backend/dist/lib/print-surface-profile.js — the backend's OWN resolved profile
 * (edition gate → Zod → merge over default → refine). This module used to
 * re-implement the @file read and the edition gate and apply no schema, so the
 * browser rendered an object the backend never validated; one parser by
 * construction closes that. Nothing here knows an edition or a key name any more.
 *
 * Only a JSON object passes. Anything else — blank (nothing configured / gate
 * closed / failed load, all rendered as "" by the printer), or malformed —
 * degrades to "no override", so the frontend inherits its code default.
 */
function passThroughSurface(raw) {
  const trimmed = raw && raw.trim()
  if (!trimmed) return undefined
  try {
    const obj = JSON.parse(trimmed)
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : undefined
  } catch (err) {
    // MUST be stderr, never stdout: the CLI entry's stdout is redirected verbatim
    // into /config.js (start.sh). A stray stdout line here lands as line 1 of the
    // file, breaks the `window.__NODARO_RUNTIME__=…;` assignment (JS syntax error),
    // and takes ALL runtime config down with it. stderr is not redirected.
    console.error("[start.sh] surface profile ignored (unreadable/invalid):", err.message)
    return undefined
  }
}

export function buildRuntimeConfig(env) {
  const cfg = {
    apiUrl: pick(env.RUNTIME_API_URL),
    supabaseUrl: pick(env.RUNTIME_SUPABASE_URL),
    supabaseAnonKey: pick(env.RUNTIME_SUPABASE_ANON_KEY),
    freecutUrl: pick(env.RUNTIME_FREECUT_URL),
    audiomassUrl: pick(env.RUNTIME_AUDIOMASS_URL),
    defaultLocale: pick(env.RUNTIME_DEFAULT_LOCALE),
    surface: passThroughSurface(env.RUNTIME_SURFACE_PROFILE),
    moderation: env.RUNTIME_UPLOAD_MODERATION === "true" ? { uploadImage: true } : undefined,
    // The preview stop rule's rollout flag (decided 2026-10-05): start.sh
    // passes the backend's own PREVIEW_STOP_RULE_ENABLED, parsed the same
    // strict way as config.ts. Off → no key, so the editor keeps the rule off.
    previewStopRule:
      env.RUNTIME_PREVIEW_STOP_RULE === "true" || env.RUNTIME_PREVIEW_STOP_RULE === "1" ? true : undefined,
    // The backend's answer, carried as it is (print-surface-profile.js
    // --media-origin): the https origin of the deployment's media host on a
    // white-label surface, "" everywhere else, so no other /config.js changes.
    mediaOrigin: pick(env.RUNTIME_MEDIA_ORIGIN),
    // A deployment whose pages have their own host (FLOW_UI_ORIGIN): a page
    // there carries a browser's saved settings over from linkOrigin, PUBLIC_URL.
    // With the move on too (LEGACY_UI_HOSTS), the page's own calls go same-origin
    // on that host, a navigation on a legacy host goes to its page's home, and
    // the addresses developers are handed keep naming linkOrigin. Absent on every
    // other deployment, so nothing changes there.
    ...movedPages(env).keys,
  }
  for (const k of Object.keys(cfg)) if (cfg[k] === undefined) delete cfg[k]
  return cfg
}

// ── The brand in index.html's head ───────────────────────────────────────────
//
// Crawlers, link previews and the browser's tab read index.html's static
// <title>, meta description and icon links before any script runs. The
// pre-paint script and BrandDocumentHead fix the title and description only
// afterwards, and nothing fixes the icons. So at boot, right after
// /config.js, the same resolved brand is written into the built file:
//
//   <title>                     ← brand.productName (left alone while it is the
//                                 platform's own name, which the resolved profile
//                                 always carries when no brand is set)
//   <meta name="description">   ← brand.description
//   the icon <link>s            ← one <link rel="icon"> per brand.favicon path;
//                                 every platform icon link goes, the home-screen
//                                 apple-touch-icon included
//
// Each is a targeted replacement inside <head>: every other byte, Vite's
// hashed asset references included, stays as built. All or nothing. When an
// anchor is missing or appears more than once, the file is left as built and
// the reason is logged (to stderr: stdout is /config.js). With no brand set,
// the file is not even read. The anchors are structural, so a restarted
// container, whose file already carries the brand, rewrites it to the same
// bytes.

/** RUNTIME_SURFACE_DEFAULT.brand.productName (cross-checked in backend/src/lib/__tests__/runtime-config-contract.test.ts). */
export const PLATFORM_PRODUCT_NAME = "Nodaro"
const MAX_FAVICONS = 4

const UNSAFE_REF_CHARS = /[\s\u0000-\u001f\u007f\\]/
const HTML_SPECIAL_CHARS = /["'<>`]/
const PROBE_ORIGIN = "https://origin.invalid"

/** isSameSitePath from @nodaro/shared/runtime-config, restated (this file imports no package); the contract test holds the two equal. */
export function isSameSitePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false
  if (UNSAFE_REF_CHARS.test(value) || HTML_SPECIAL_CHARS.test(value)) return false
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
  } catch {
    return false
  }
}

const ICON_TYPES = { svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", webp: "image/webp", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", avif: "image/avif" }

function iconType(path) {
  const name = path.split(/[?#]/, 1)[0].split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  return dot > 0 ? ICON_TYPES[name.slice(dot + 1).toLowerCase()] : undefined
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;")

/** What the brand asks of the head: only the parts it actually sets, or undefined for none. */
export function brandHeadRequest(brand) {
  if (!brand || typeof brand !== "object" || Array.isArray(brand)) return undefined
  const want = {}
  const name = typeof brand.productName === "string" ? brand.productName.trim() : ""
  if (name && name !== PLATFORM_PRODUCT_NAME) want.title = name
  const description = typeof brand.description === "string" ? brand.description.trim() : ""
  if (description) want.description = description
  const icons = [...new Set((Array.isArray(brand.favicon) ? brand.favicon : [brand.favicon]).filter(isSameSitePath))]
  if (icons.length) want.favicon = icons.slice(0, MAX_FAVICONS)
  return Object.keys(want).length ? want : undefined
}

const TITLE = /<title>[^<]*<\/title>/g
const DESCRIPTION = /<meta\b[^>]*\bname=["']description["'][^>]*>/gi
const CONTENT_ATTR = /\bcontent="[^"]*"/g
const ICON_LINK = /<link\b[^>]*\brel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi

/** A match's span, widened to its whole line when nothing else shares that line. */
function lineSpan(text, start, end) {
  let from = start
  while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from--
  let to = end
  if (from === 0 || text[from - 1] === "\n") {
    if (text.startsWith("\r\n", to)) to += 2
    else if (text[to] === "\n") to += 1
    else from = start
  } else {
    from = start
  }
  return [from, to]
}

/**
 * `html` with the brand written into its head: `{ html, applied, problems }`.
 * Pure. On any problem `html` comes back unchanged (all or nothing).
 */
export function applyBrandHead(html, brand) {
  const want = brandHeadRequest(brand)
  if (!want) return { html, applied: [], problems: [] }
  const open = /<head\b[^>]*>/i.exec(html)
  const close = open ? html.indexOf("</head>", open.index) : -1
  if (!open || close < 0) return { html, applied: [], problems: ["no <head>…</head>"] }
  const start = open.index + open[0].length
  let head = html.slice(start, close)
  const problems = []
  const applied = []

  if (want.title !== undefined) {
    const n = (head.match(TITLE) ?? []).length
    if (n !== 1) problems.push(`<title> found ${n} times`)
    else {
      head = head.replace(TITLE, () => `<title>${escapeText(want.title)}</title>`)
      applied.push("title")
    }
  }

  if (want.description !== undefined) {
    const tags = head.match(DESCRIPTION) ?? []
    const contents = tags.length === 1 ? (tags[0].match(CONTENT_ATTR) ?? []).length : 0
    if (tags.length !== 1) problems.push(`<meta name="description"> found ${tags.length} times`)
    else if (contents !== 1) problems.push('<meta name="description"> has no single content="…"')
    else {
      head = head.replace(DESCRIPTION, (tag) => tag.replace(CONTENT_ATTR, () => `content="${escapeAttr(want.description)}"`))
      applied.push("description")
    }
  }

  if (want.favicon !== undefined) {
    const links = [...head.matchAll(ICON_LINK)]
    if (links.length === 0) problems.push("no icon <link>")
    else {
      const first = links[0]
      const indent = /[ \t]*$/.exec(head.slice(0, first.index))[0]
      const lines = want.favicon.map((path) => {
        const type = iconType(path)
        return `<link rel="icon"${type ? ` type="${type}"` : ""} href="${escapeAttr(path)}" />`
      })
      // Later links first, so the earlier spans keep their offsets.
      for (const link of links.slice(1).reverse()) {
        const [from, to] = lineSpan(head, link.index, link.index + link[0].length)
        head = head.slice(0, from) + head.slice(to)
      }
      head = head.slice(0, first.index) + lines.join(`\n${indent}`) + head.slice(first.index + first[0].length)
      applied.push("favicon")
    }
  }

  if (problems.length) return { html, applied: [], problems }
  return { html: html.slice(0, start) + head + html.slice(close), applied, problems: [] }
}

/**
 * Replaces `file`'s content: atomically when its directory is writable (a
 * temporary file renamed over it), else in place. The image may leave the
 * directory to root while the file belongs to this user. In place is safe at
 * boot, because nothing serves the file yet (start.sh starts Caddy after this
 * step). A failed in-place write puts the original bytes back.
 */
function replaceFile(file, next, original) {
  const tmp = `${file}.brand-${process.pid}.tmp`
  try {
    writeFileSync(tmp, next)
    renameSync(tmp, file)
    return
  } catch {
    try {
      unlinkSync(tmp)
    } catch {
      // never created, or already renamed
    }
  }
  try {
    writeFileSync(file, next)
  } catch (err) {
    try {
      writeFileSync(file, original)
    } catch {
      // nothing more to try; the caller logs the first error
    }
    throw err
  }
}

/**
 * Writes the brand into the index.html at `file`. Never throws: a failure
 * logs, and the file stays as built. Returns what happened, for tests.
 */
export function writeBrandHead(file, brand, log = (line) => console.error(line)) {
  try {
    if (!brandHeadRequest(brand)) return "inert"
    let html
    try {
      html = readFileSync(file, "utf8")
    } catch (err) {
      log(`[start.sh] brand head NOT applied: cannot read ${file} (${err.code ?? err.message}); the page keeps the platform's head`)
      return "unreadable"
    }
    const { html: next, applied, problems } = applyBrandHead(html, brand)
    if (problems.length) {
      log(`[start.sh] brand head NOT applied: ${problems.join("; ")} in ${file}; it is left as built`)
      return "anchors-missing"
    }
    if (next === html) {
      log(`[start.sh] brand head already in ${file} (${applied.join(", ")})`)
      return "unchanged"
    }
    replaceFile(file, next, html)
    log(`[start.sh] brand head applied to ${file}: ${applied.join(", ")}`)
    return "applied"
  } catch (err) {
    log(`[start.sh] brand head NOT applied: ${err.message}; ${file} is left as built`)
    return "failed"
  }
}

/** `--index-html <path>` / `--index-html=<path>`, else the image's layout: /app/tools → /app/frontend/dist/index.html. */
export function indexHtmlPath(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--index-html" && argv[i + 1]) return argv[i + 1]
    if (argv[i].startsWith("--index-html=")) return argv[i].slice("--index-html=".length)
  }
  return fileURLToPath(new URL("../frontend/dist/index.html", import.meta.url))
}

// CLI entry: `node build-runtime-config.mjs [--index-html <path>]` prints the
// /config.js line, then writes the brand into the page's head. The head step
// never touches stdout or the exit code: start.sh reads a non-zero exit as
// "could not write /config.js".
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = buildRuntimeConfig(process.env)
  process.stdout.write("window.__NODARO_RUNTIME__=" + JSON.stringify(cfg) + ";\n")
  console.error("[start.sh] frontend runtime config:", Object.keys(cfg).join(",") || "(none — build-time values)")
  const { problem } = movedPages(process.env)
  if (problem) console.error(`[start.sh] moving the app's pages: ${problem}`)
  writeBrandHead(indexHtmlPath(process.argv.slice(2)), cfg.surface?.brand)
}
