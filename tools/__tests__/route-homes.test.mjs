import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { renderBlock, spliceBlock, loadHomes, CADDYFILE_PATH } from "../gen-route-homes.mjs"

/**
 * frontend/src/route-homes.json says where every page of the app lives once a
 * deployment moves its UI to its own host. A route added to router.tsx that
 * the list does not place fails here, so a new page is a decision and never
 * lands on either host by default; the Caddy block is generated from the list
 * and must match it.
 *
 * The router file is read as text on purpose: its paths come from whichever
 * build (admin routes, organization routes, surface-profile switches), and a
 * test that imported the tree would only see one build's.
 */

const routerText = readFileSync(new URL("../../frontend/src/router.tsx", import.meta.url), "utf8")
const homes = loadHomes()

/** Every route path of the file as a full path: absolute as written; a nested path (the admin block) under its parent. */
function routerPaths() {
  const paths = []
  const adminStart = routerText.indexOf("const adminRoutes")
  const adminEnd = routerText.indexOf("const communityRoutes")
  assert.ok(adminStart !== -1 && adminEnd > adminStart, "router.tsx: the admin block moved; update this test")
  for (const match of routerText.matchAll(/path:\s*"([^"]+)"/g)) {
    const literal = match[1]
    if (literal === "*") continue // the not-found catch-all is not a page of its own
    if (literal.startsWith("/")) {
      paths.push(literal)
    } else {
      assert.ok(match.index > adminStart && match.index < adminEnd, `router.tsx: the relative path "${literal}" is outside the admin block; place it in route-homes.json by hand`)
      paths.push(`/admin/${literal}`)
    }
  }
  assert.ok(paths.length > 60, `router.tsx: only ${paths.length} route paths found; the parse below is wrong`)
  return paths
}

const looksLikeFile = (entry) => /\.[a-z0-9]+$/.test(entry)

/** Whether a list entry (`/app/*`, `/login`) covers a route path. A wildcard covers its sub-paths, never the bare path. */
function covers(entry, route) {
  if (entry.endsWith("/*")) return route.startsWith(entry.slice(0, -1))
  return entry === route
}

test("every route in router.tsx is placed, in exactly one list", () => {
  const unplaced = []
  const twice = []
  for (const route of routerPaths()) {
    const inKept = homes.kept.filter((entry) => covers(entry, route))
    const inMoved = homes.moved.filter((entry) => covers(entry, route))
    if (inKept.length + inMoved.length === 0) unplaced.push(route)
    if (inKept.length > 0 && inMoved.length > 0) twice.push(route)
  }
  assert.deepEqual(unplaced, [], `add these to frontend/src/route-homes.json ("kept" or "moved"): ${unplaced.join(", ")}`)
  assert.deepEqual(twice, [], `in both kept and moved: ${twice.join(", ")}`)
})

test("no entry is stale: every page entry covers a real route", () => {
  const routes = routerPaths()
  const stale = [...homes.kept, ...homes.moved].filter((entry) => !looksLikeFile(entry) && !routes.some((route) => covers(entry, route)))
  assert.deepEqual(stale, [], `not a route any more: ${stale.join(", ")}`)
})

test("every keptOnly page is a kept page", () => {
  for (const entry of homes.keptOnly) assert.ok(homes.kept.includes(entry), entry)
})

test("the page-homes block in frontend/Caddyfile is the one the list generates", () => {
  const current = readFileSync(CADDYFILE_PATH, "utf8")
  assert.equal(spliceBlock(current, renderBlock(homes)), current, "frontend/Caddyfile's page-homes block is out of date. Run: npm run gen:route-homes")
})

test("the files list is the one the proxy's @missing_file block treats as files", () => {
  const caddyfile = readFileSync(CADDYFILE_PATH, "utf8")
  const block = caddyfile.slice(caddyfile.indexOf("@missing_file {"))
  const line = block.slice(0, block.indexOf("\n", block.indexOf("path ")))
  const extensions = line.slice(line.indexOf("path ") + "path ".length).trim().split(/\s+/).map((pattern) => pattern.replace(/^\*\./, ""))
  assert.deepEqual(homes.files, extensions)
})
