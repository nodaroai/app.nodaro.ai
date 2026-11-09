import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A deployment may serve other web apps beside the editor on the same host.
 * Its image adds their routes as files in /etc/caddy/sites.d/, which the
 * Caddyfile imports into its one site; it never edits the Caddyfile itself.
 * With no file there (every deployment by default, and the directory need not
 * exist) the site must be exactly what it was.
 *
 * Runs the real Caddyfile, like app-prerender-header.test.mjs; skipped without
 * a Caddy binary (set CADDY_BIN to point at one). CI installs the version the
 * image pins.
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const CADDYFILE = readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
const IMPORT_LINE = "import /etc/caddy/sites.d/*.caddy"
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

test("the Caddyfile imports the extra site routes once, at the top level of its one site", () => {
  const lines = CADDYFILE.split("\n")
  const at = lines.flatMap((line, index) => (line.trim() === IMPORT_LINE ? [index] : []))
  assert.equal(at.length, 1, `exactly one "${IMPORT_LINE}"`)
  // One tab: a directive of the :3000 site itself, never inside a handle (a
  // route there could only ever be reached through that handle's matcher).
  assert.equal(lines[at[0]], `\t${IMPORT_LINE}`)
  const site = lines.findIndex((line) => line.startsWith(":3000 {"))
  assert.ok(site !== -1 && site < at[0], "inside the :3000 site block")
  // The only other imports are the client-address snippet.
  const others = lines.filter((line) => /^\s*import\s/.test(line) && line.trim() !== IMPORT_LINE)
  assert.ok(others.every((line) => line.trim() === "import client_ip_header"), others.join("\n"))
})

/** The real Caddyfile on a free port, its dist and its extra-routes directory moved into `temp`. */
function config(temp, port, sitesDir) {
  const dist = join(temp, "dist").replace(/\\/g, "/")
  const text = CADDYFILE.replace(":3000 {", `:${port} {`)
    .replaceAll("/app/frontend/dist", dist)
    .replace(IMPORT_LINE, `import ${sitesDir.replace(/\\/g, "/")}/*.caddy`)
  assert.notEqual(text, CADDYFILE.replace(":3000 {", `:${port} {`).replaceAll("/app/frontend/dist", dist), "the import line was rewritten")
  const file = join(temp, "Caddyfile")
  writeFileSync(file, text)
  return file
}

function site(temp) {
  const dist = join(temp, "dist")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>spa</title>")
  writeFileSync(join(dist, "assets", "app-abc123.js"), "export {}")
}

async function serve(file, port, check) {
  const child = spawn(CADDY, ["run", "--config", file, "--adapter", "caddyfile"], { stdio: ["ignore", "ignore", "pipe"] })
  let logs = ""
  child.stderr.on("data", (data) => { logs += data })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(`http://127.0.0.1:${port}/index.html`); break } catch {
        if (child.exitCode !== null) assert.fail(logs)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    await check(async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      return { status: response.status, body: await response.text() }
    })
    return logs
  } finally {
    child.kill()
    await exited
  }
}

async function freePort() {
  const probe = createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

for (const [label, prepare] of [
  ["absent", () => {}],
  ["empty", (dir) => mkdirSync(dir, { recursive: true })],
]) {
  test(`with the directory ${label}, Caddy validates and serves the site as before`, { skip: !available }, async () => {
    const temp = mkdtempSync(join(tmpdir(), "caddy-sites-"))
    try {
      site(temp)
      const sites = join(temp, "sites.d")
      prepare(sites)
      const port = await freePort()
      const file = config(temp, port, sites)
      const validate = spawnSync(CADDY, ["validate", "--config", file, "--adapter", "caddyfile"], { encoding: "utf8" })
      assert.equal(validate.status, 0, `${validate.stdout}${validate.stderr}`)
      const logs = await serve(file, port, async (get) => {
        assert.deepEqual(await get("/"), { status: 200, body: "<!doctype html><title>spa</title>" })
        assert.deepEqual(await get("/extra"), { status: 200, body: "<!doctype html><title>spa</title>" })
        assert.equal((await get("/assets/app-abc123.js")).body, "export {}")
      })
      // Expected and harmless: Caddy says the pattern matched nothing.
      assert.match(logs, /No files matching import glob pattern/)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
}

test("a route file there is answered before the SPA, and leaves the editor's own routes alone", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "caddy-sites-"))
  try {
    site(temp)
    const sites = join(temp, "sites.d")
    mkdirSync(sites)
    writeFileSync(join(sites, "other-app.caddy"), ["@other_app path /extra /extra/*", "handle @other_app {", '\trespond "other app" 200', "}", ""].join("\n"))
    const port = await freePort()
    const file = config(temp, port, sites)
    await serve(file, port, async (get) => {
      assert.deepEqual(await get("/extra"), { status: 200, body: "other app" })
      assert.deepEqual(await get("/extra/deep/link"), { status: 200, body: "other app" })
      // Exact path and /*: a longer name is not the other app's.
      assert.deepEqual(await get("/extra-thing"), { status: 200, body: "<!doctype html><title>spa</title>" })
      assert.deepEqual(await get("/projects"), { status: 200, body: "<!doctype html><title>spa</title>" })
      assert.equal((await get("/assets/app-abc123.js")).body, "export {}")
      // The API keeps its own block (no backend runs here: the proxy's error, not the other app).
      assert.notEqual((await get("/v1/anything")).body, "other app")
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
