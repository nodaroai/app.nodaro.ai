import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { renderBlock, spliceBlock, loadHomes, CADDYFILE_PATH, canonicalHomes, canonicalPattern } from "../gen-route-homes.mjs"

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

test("the indexable list is the Caddyfile's @spa_noindex allow-list", () => {
  const caddyfile = readFileSync(CADDYFILE_PATH, "utf8")
  const block = caddyfile.slice(caddyfile.indexOf("@spa_noindex {"))
  const line = block.split("\n").find((text) => text.trim().startsWith("not path / "))
  assert.ok(line, "@spa_noindex has its allow-list line")
  assert.deepEqual(line.trim().slice("not path ".length).split(/\s+/), homes.indexable)
})

test("every indexable page has one home, moved or kept, so it names one canonical", () => {
  const { flow, kept } = canonicalHomes(homes)
  assert.deepEqual([...flow, ...kept].sort(), [...homes.indexable].sort())
  assert.throws(() => canonicalHomes({ ...homes, indexable: [...homes.indexable, "/nowhere"] }), /\/nowhere/)
})

test("a canonical names only an exact listed address: a page as written, a section and one lowercase slug", () => {
  const pattern = new RegExp(canonicalPattern(["/", "/gallery", "/tutorials/*"]))
  for (const path of ["/", "/gallery", "/tutorials/getting-started", "/tutorials/a1-b2"]) assert.ok(pattern.test(path), path)
  for (const path of ["", "//", "/gallery/", "/Gallery", "/tutorials", "/tutorials/", "/tutorials/a/b", "/tutorials/a.b", "/tutorials/A", "/tutorials/a_b", "/tutorials/a>b", "/x/../gallery"]) {
    assert.equal(pattern.test(path), false, path)
  }
  // A listed address that is not a plain lowercase one is refused when the block is written.
  for (const entry of ["/Gallery", "/a b", "/a/*/b", "gallery", "/gallery/", "/a.b"]) assert.throws(() => canonicalPattern([entry]), new RegExp(entry.replace(/[.*+?^$()|[\]\\]/g, "\\$&")))
})
