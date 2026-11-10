#!/usr/bin/env node
/**
 * Writes the part of frontend/Caddyfile that sends a deployment's moved pages
 * to their own host, from frontend/src/route-homes.json. The Caddyfile keeps a
 * generated block between two markers; everything else in it is hand-written.
 *
 *   npm run gen:route-homes   rewrites the block (tools/__tests__/route-homes.test.mjs
 *                             fails CI when it is out of date)
 *
 * The block is inert: it answers only for hosts LEGACY_UI_HOSTS names, and only
 * with FLOW_UI_ORIGIN an https origin (docs/deployment.md). Only the pages the
 * list moves ever move: an unknown path, another app's route (sites.d) and every
 * file stay. Every setting is read per request ({env.…}), never pasted into the
 * config's text, so no value (a quote, a backslash) can stop Caddy from starting:
 * the two origins are matched against a pattern and only a match is used.
 * Changing one needs a restart, never a rebuild.
 *
 * Path matching is Caddy's: case-insensitive, with `//` merged, dot segments
 * resolved and `%2F` decoded. The browser's guard (frontend/src/lib/page-homes.ts)
 * decides the same way from the same list; one address table holds both to it
 * (tools/__tests__/fixtures/route-home-addresses.json).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
export const CADDYFILE_PATH = join(repoRoot, "frontend/Caddyfile")
export const HOMES_PATH = join(repoRoot, "frontend/src/route-homes.json")

const BEGIN = "\t# BEGIN GENERATED: page homes (tools/gen-route-homes.mjs from frontend/src/route-homes.json)"
const END = "\t# END GENERATED: page homes"

export function loadHomes() {
  return JSON.parse(readFileSync(HOMES_PATH, "utf8"))
}

/** A list's patterns as Caddy matches them: an exact page (`/login`) also with its trailing slash (`/login/`); a prefix (`/app/*`) as written. */
export function caddyPatterns(entries) {
  return entries.flatMap((entry) => (entry.endsWith("/*") || entry === "/" ? [entry] : [entry, `${entry}/`]))
}

// The settings, as the expressions read them. The host list is split by one
// rule, the /config.js writer's too: commas are spaces, any run of spaces
// separates, letter case is ignored.
const HOSTS = `{env.LEGACY_UI_HOSTS}.lowerAscii().replace(",", " ").split(" ")`
const FLOW = "{nodaro_flow_origin}"
const KEPT = "{nodaro_kept_origin}"
const HERE = `"https://" + {http.request.host}.lowerAscii()`
// A framed load (Sec-Fetch-Dest iframe, frame, embed or object) is never redirected: every product's account pop-up frames these pages.
const NOT_FRAMED = `!({http.request.header.Sec-Fetch-Dest} in ["iframe", "frame", "embed", "object"])`
// The move is on with a valid Flow origin, a valid kept origin (PUBLIC_URL) that is not the Flow origin, and at
// least one legacy host that is not the Flow host itself: the one rule the /config.js writer, the browser and the
// server's boot check also read (tools/build-runtime-config.mjs, frontend/src/lib/runtime-config.ts,
// backend/src/lib/moved-pages-settings.ts).
const MOVE_ON = `${FLOW} != "" && ${KEPT} != "" && ${KEPT} != ${FLOW} && ${HOSTS}.exists(h, h != "" && "https://" + h != ${FLOW})`

/** The generated block, for the top level of the site. */
export function renderBlock(homes) {
  const lines = [
    BEGIN,
    "\t# A page of the app moved to its own host: a top-level visit to a moved page on a",
    "\t# host named in LEGACY_UI_HOSTS answers one redirect to the same path and query on",
    "\t# FLOW_UI_ORIGIN (302 no-store, or 301 with LEGACY_UI_REDIRECT_STATUS=301 and a one-hour",
    "\t# browser-only cache). Only the listed pages move: kept pages (OAuth, sign-in, published",
    "\t# apps), unknown paths, other apps' routes, files and framed loads (Sec-Fetch-Dest",
    "\t# iframe/frame/embed/object: every product's account pop-up) stay. Settings are read per",
    "\t# request; with them unset or malformed (PUBLIC_URL included) the block never answers. See docs/deployment.md.",
    "\t# The two origins, a trailing slash allowed; empty unless the value is an https origin.",
    "\tmap {env.FLOW_UI_ORIGIN} {nodaro_flow_origin} {",
    '\t\t~^(https://[a-z0-9.-]+)/?$ "${1}"',
    '\t\tdefault ""',
    "\t}",
    "\tmap {env.PUBLIC_URL} {nodaro_kept_origin} {",
    '\t\t~^(https://[a-z0-9.-]+)/?$ "${1}"',
    '\t\tdefault ""',
    "\t}",
    '\t@legacy_ui_permanent expression `{env.LEGACY_UI_REDIRECT_STATUS} == "301"`',
    '\t@legacy_ui_temporary expression `{env.LEGACY_UI_REDIRECT_STATUS} != "301"`',
    "\t@legacy_ui_page {",
    `\t\texpression \`${MOVE_ON} && ${HOSTS}.exists(h, h != "" && h == {http.request.host}.lowerAscii()) && ${HERE} != ${FLOW} && ${NOT_FRAMED}\``,
    "\t\tmethod GET HEAD",
    `\t\tpath ${caddyPatterns(homes.moved).join(" ")}`,
    `\t\tnot path ${homes.files.map((ext) => `*.${ext}`).join(" ")}`,
    "\t\tnot file {",
    "\t\t\troot /app/frontend/dist",
    "\t\t}",
    "\t}",
    "\thandle @legacy_ui_page {",
    '\t\theader @legacy_ui_permanent Cache-Control "private, max-age=3600"',
    '\t\theader @legacy_ui_temporary Cache-Control "no-store"',
    '\t\theader Vary "Sec-Fetch-Dest"',
    `\t\tredir @legacy_ui_permanent ${FLOW}{uri} 301`,
    `\t\tredir @legacy_ui_temporary ${FLOW}{uri} 302`,
    "\t}",
    "\t# On the Flow host, the public pages whose one home is the kept host go back to it.",
    "\t@flow_host_public_page {",
    `\t\texpression \`${MOVE_ON} && ${HERE} == ${FLOW} && ${NOT_FRAMED}\``,
    "\t\tmethod GET HEAD",
    `\t\tpath ${caddyPatterns(homes.keptOnly).join(" ")}`,
    "\t}",
    "\thandle @flow_host_public_page {",
    '\t\theader @legacy_ui_permanent Cache-Control "private, max-age=3600"',
    '\t\theader @legacy_ui_temporary Cache-Control "no-store"',
    '\t\theader Vary "Sec-Fetch-Dest"',
    `\t\tredir @legacy_ui_permanent ${KEPT}{uri} 301`,
    `\t\tredir @legacy_ui_temporary ${KEPT}{uri} 302`,
    "\t}",
    "\t# The page that hands a browser's saved settings to the Flow host",
    "\t# (frontend/public/storage-bridge.html) is there only while the move is on,",
    "\t# framable only by the Flow origin. Otherwise the path answers exactly as on",
    "\t# an install without the file: as any unknown page, the app's index.",
    "\t@storage_bridge_on {",
    "\t\tpath /storage-bridge.html",
    `\t\texpression \`${MOVE_ON}\``,
    "\t}",
    `\theader @storage_bridge_on Content-Security-Policy "frame-ancestors ${FLOW}"`,
    "\t# Its trailing-slash form too: the proxy would redirect it to the file, which",
    "\t# an install without the move does not have.",
    "\t@storage_bridge_off {",
    "\t\tpath /storage-bridge.html /storage-bridge.html/",
    `\t\texpression \`!(${MOVE_ON})\``,
    "\t}",
    "\trewrite @storage_bridge_off /index.html",
    END,
    "",
  ]
  return lines.join("\n")
}

export function spliceBlock(caddyfile, block) {
  const start = caddyfile.indexOf(BEGIN)
  const finish = caddyfile.indexOf(END)
  if (start === -1 || finish === -1 || finish < start) throw new Error("frontend/Caddyfile has no generated page-homes block")
  return caddyfile.slice(0, start) + block.replace(/\n$/, "") + caddyfile.slice(finish + END.length)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check")
  const current = readFileSync(CADDYFILE_PATH, "utf8")
  const next = spliceBlock(current, renderBlock(loadHomes()))
  if (next === current) process.exit(0)
  if (check) {
    console.error("frontend/Caddyfile's page-homes block is out of date. Run: npm run gen:route-homes")
    process.exit(1)
  }
  writeFileSync(CADDYFILE_PATH, next)
}
