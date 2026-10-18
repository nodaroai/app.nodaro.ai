/**
 * The subpath entries of @nodaro/sdk (`@nodaro/sdk/<entry>`, one per resource
 * in src/entries/, plus `client` and `errors`) — additive to the root, which
 * stays the union of them.
 *
 * External consumers pin older versions and import only the root, so the root
 * may only grow (baseline: fixtures/root-exports.baseline.json, recorded from
 * the last single-bundle build). Most checks read the BUILT dist, which is what
 * consumers load — CI builds the packages before this suite runs; locally run
 * `npm run build:packages` first.
 *
 * The checks live in tools/package-entries/entries-guard.mjs (shared with
 * @nodaro/shared and @nodaro/prompts); each returns the problems it found.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
// @ts-expect-error — untyped .mjs tooling module
import * as guard from "../../../../tools/package-entries/entries-guard.mjs"

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const PKG = "@nodaro/sdk"

/**
 * The two standalone subpaths published before the entries existed. They are
 * not part of the root (supabase-browser needs the optional @supabase peers)
 * and keep their original dist files.
 */
const LEGACY_SUBPATHS = {
  "./supabase": { types: "./dist/supabase-browser.d.ts", import: "./dist/supabase-browser.js", require: "./dist/supabase-browser.cjs" },
  "./signup-signals": { types: "./dist/signup-signals.d.ts", import: "./dist/signup-signals.js", require: "./dist/signup-signals.cjs" },
}

describe("@nodaro/sdk subpath entries", () => {
  it("src/index.ts only re-exports every entry in src/entries/", () => {
    expect(guard.indexShapeErrors(PKG_DIR)).toEqual([])
  })

  it("package.json exports = the unchanged root + one subpath per entry + the two legacy subpaths", () => {
    expect(guard.exportsMapErrors(PKG_DIR, LEGACY_SUBPATHS)).toEqual([])
  })

  it("every exports target is built", () => {
    expect(guard.distFileErrors(PKG_DIR)).toEqual([])
  })

  it("the root still exports every baseline name (types d.ts + d.cts, values ESM + CJS)", async () => {
    expect(await guard.rootAdditiveErrors(PKG_DIR)).toEqual([])
  }, 60_000)

  it("the root's names are exactly the union of the entries' names, each with one owner", () => {
    expect(guard.unionErrors(PKG_DIR, {})).toEqual([])
  }, 60_000)

  it("each subpath's types resolve from a consumer (bundler + NodeNext)", () => {
    expect(guard.typeResolutionErrors(PKG_DIR, PKG)).toEqual([])
  })

  it("each subpath loads ALONE by package name (fresh process, ESM + CJS) and shares the root's instances", async () => {
    expect(await guard.consumerLoadErrors(PKG_DIR, PKG)).toEqual([])
  }, 120_000)
})
