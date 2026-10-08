import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Files a running build does not have. Every name under /assets carries its
 * content hash, and a page an earlier deployment served still asks for its
 * own: a session replay renders a recording with the stylesheet its visitor
 * had, a tab stays open across a deploy. Caddy serves the build's files for
 * good, asks the backend's archive of past builds' styling files for any
 * other /assets name, and never answers a file URL with the SPA's HTML — the
 * CDN in front would keep that HTML under the file's URL for a year.
 *
 * Runs the real Caddyfile against a stand-in backend, like
 * app-search-indexing.test.mjs; skipped without a Caddy binary (CI installs
 * the image's version; set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
const IMMUTABLE = "public, max-age=31536000, immutable"

/** The archive as the backend answers it: one stylesheet from an earlier build, 404 for anything else. */
function standInBackend(asked) {
  return createServer((req, res) => {
    asked.push({ url: req.url, secret: req.headers["x-internal-orchestrator-secret"] })
    if (req.url === "/v1/site-assets/assets/index-OldBuild.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": IMMUTABLE, "access-control-allow-origin": "*" })
      res.end("body{color:rebeccapurple}")
      return
    }
    res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" })
    res.end('{"error":{"code":"not_found","message":"No such file."}}')
  })
}

test("a build's files are kept for good, older styling files come from the archive, and no file URL ever answers with the SPA's HTML", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "site-assets-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  mkdirSync(join(dist, "fonts"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")
  writeFileSync(join(dist, "assets", "index-NewBuild.css"), "body{color:teal}")
  writeFileSync(join(dist, "assets", "index-NewBuild.js"), "export {}")
  writeFileSync(join(dist, "fonts", "geist.woff2"), "wOF2")

  const asked = []
  const backend = standInBackend(asked)
  const backendPort = await listen(backend)
  const portProbe = createServer()
  const port = await listen(portProbe)
  await new Promise((resolve) => portProbe.close(resolve))
  const config = join(temp, "Caddyfile")
  writeFileSync(
    config,
    readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
      .replace(":3000 {", `:${port} {`)
      .replaceAll("/app/frontend/dist", dist)
      .replaceAll("127.0.0.1:9000", `127.0.0.1:${backendPort}`),
  )
  const child = spawn(CADDY, ["run", "--config", config, "--adapter", "caddyfile"], { stdio: ["ignore", "ignore", "pipe"] })
  let logs = ""
  child.stderr.on("data", (data) => {
    logs += data
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  const get = async (path, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers })
    return { status: response.status, headers: response.headers, body: await response.text() }
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`)
        break
      } catch {
        if (child.exitCode !== null) assert.fail(logs)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    // This build's stylesheet: from disk, as CSS, cached for good, readable from a replay player's origin.
    const own = await get("/assets/index-NewBuild.css")
    assert.equal(own.status, 200)
    assert.match(own.headers.get("content-type"), /^text\/css/)
    assert.equal(own.headers.get("cache-control"), IMMUTABLE)
    assert.equal(own.headers.get("access-control-allow-origin"), "*")
    assert.equal(own.body, "body{color:teal}")
    assert.equal(asked.length, 0, "a file the build has never reaches the archive")

    // An earlier build's stylesheet: from the archive, at its original URL, every header once.
    const old = await get("/assets/index-OldBuild.css", { "X-Internal-Orchestrator-Secret": "from-outside" })
    assert.equal(old.status, 200)
    assert.equal(old.body, "body{color:rebeccapurple}")
    assert.match(old.headers.get("content-type"), /^text\/css/)
    assert.equal(old.headers.get("cache-control"), IMMUTABLE)
    assert.equal(old.headers.get("access-control-allow-origin"), "*")
    assert.deepEqual(asked.at(-1), { url: "/v1/site-assets/assets/index-OldBuild.css", secret: undefined })

    // Names nobody has — a stylesheet, a script (scripts are never archived), files outside /assets:
    // a 404 nobody caches, never the SPA's HTML.
    for (const path of ["/assets/index-Gone.css", "/assets/chunk-Gone.js", "/assets/", "/fonts/gone.woff2", "/logo-gone.png", "/gone.css", "/intro-gone.mp4"]) {
      const missing = await get(path)
      assert.equal(missing.status, 404, `${path} should be a 404`)
      assert.equal(missing.headers.get("cache-control"), "no-store", `${path} must not be cached`)
      assert.doesNotMatch(missing.headers.get("content-type") ?? "", /html/, `${path} must not answer with HTML`)
      assert.doesNotMatch(missing.body, /<title>Nodaro\.ai<\/title>/, `${path} must not answer with the SPA shell`)
    }

    // Fonts load with CORS: a replay player draws them from its own origin.
    const font = await get("/fonts/geist.woff2")
    assert.equal(font.status, 200)
    assert.equal(font.headers.get("access-control-allow-origin"), "*")

    // The SPA keeps its routes — a dotted token included — and its shell is never cached.
    for (const path of ["/", "/projects/123", "/join/a1b2.c3d4.e5f6"]) {
      const page = await get(path)
      assert.equal(page.status, 200, `${path} should render the app`)
      assert.match(page.headers.get("content-type"), /^text\/html/)
      assert.match(page.body, /<title>Nodaro\.ai<\/title>/)
    }
    assert.equal((await get("/projects/123")).headers.get("cache-control"), "no-cache")
  } finally {
    child.kill()
    await exited
    await new Promise((resolve) => backend.close(resolve))
    rmSync(temp, { recursive: true, force: true })
  }
})
