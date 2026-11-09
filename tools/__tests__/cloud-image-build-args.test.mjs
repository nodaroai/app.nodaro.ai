import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/**
 * The cloud image (.github/workflows/cloud-image.yml) is the one build every
 * deployment of its own runs, so what it bakes in is what each of them gets
 * before its runtime config says anything. Pinned here, argument by argument:
 *
 *   - the shared site header is built in as "white-label": it shows only where
 *     a deployment's surface profile asks for its own header, and Nodaro's
 *     header ("true") never does — a deployment without the key renders
 *     exactly as before (frontend/src/lib/site-header-mode.ts);
 *   - none of the header's link origins (VITE_HOME_URL, VITE_TOOLS_URL,
 *     VITE_STUDIO_URL): they name Nodaro's hosts, and a white-label header
 *     links the deployment's own site;
 *   - the runtime-overridable trio is a localhost placeholder each deployment
 *     replaces at boot through /config.js;
 *   - and the workflow proves the pushed image carries the header.
 */

const repo = new URL("../../", import.meta.url)
const workflow = readFileSync(new URL(".github/workflows/cloud-image.yml", repo), "utf8")

/** The `build-args: |` block of the build step, as KEY=VALUE pairs in order. */
function buildArgs(text) {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => /^\s*build-args:\s*\|\s*$/.test(line))
  assert.ok(start !== -1, "cloud-image.yml has a build-args block")
  const indent = lines[start + 1].match(/^\s*/)[0]
  const args = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(indent) || line.trim() === "") break
    const [key, ...rest] = line.trim().split("=")
    args.push([key, rest.join("=")])
  }
  return args
}

/** The flag values the header's resolver builds the header in with (header-module-plugin.ts). */
function headerFlagValues() {
  const plugin = readFileSync(new URL("frontend/src/ee/shell/header-module-plugin.ts", repo), "utf8")
  const list = plugin.match(/SHARED_HEADER_FLAG_VALUES[^=]*=\s*Object\.freeze\(\[([^\]]*)\]\)/)?.[1]
  assert.ok(list, "header-module-plugin.ts declares SHARED_HEADER_FLAG_VALUES")
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

const args = buildArgs(workflow)
const value = (key) => args.find(([k]) => k === key)?.[1]

test("the cloud image's build args are exactly these", () => {
  assert.deepEqual(
    args.map(([key]) => key),
    [
      "VITE_EDITION",
      "VITE_SHARED_HEADER",
      "APP_VERSION",
      "VITE_APP_VERSION",
      "VITE_API_URL",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_ANON_KEY",
      "NPM_TOKEN",
      "CLOUD_PLUGINS_VERSION",
    ],
  )
  assert.equal(value("VITE_EDITION"), "cloud")
})

test("the shared header is built in as white-label only: Nodaro's header never turns on for a deployment of its own", () => {
  assert.equal(value("VITE_SHARED_HEADER"), "white-label")
  assert.ok(headerFlagValues().includes("white-label"), "the resolver builds the header in for that value")
  assert.notEqual(value("VITE_SHARED_HEADER"), "true")
})

test("no link origin of Nodaro's is baked into the image", () => {
  for (const key of ["VITE_HOME_URL", "VITE_TOOLS_URL", "VITE_STUDIO_URL"]) assert.equal(value(key), undefined, key)
  for (const [key, v] of args) assert.doesNotMatch(v, /nodaro\.ai/, `${key} names a Nodaro host`)
})

test("the runtime-overridable trio is a localhost placeholder (each deployment's /config.js replaces it)", () => {
  assert.equal(value("VITE_API_URL"), "http://localhost:3000")
  assert.equal(value("VITE_SUPABASE_URL"), "http://localhost:3000/supabase")
  assert.match(value("VITE_SUPABASE_ANON_KEY") ?? "", /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/)
})

test("the token is passed from the secret only, and the pushed image is checked for the header", () => {
  assert.equal(value("NPM_TOKEN"), "${{ secrets.NPM_TOKEN }}")
  assert.match(workflow, /\/app\/frontend\/dist\/shell-version\.json/)
  assert.match(workflow, /f\.header!==true/)
})
