import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * ROBOTS_NOINDEX=true marks a deployment that search engines must never index
 * (a staging environment): every response carries X-Robots-Tag: noindex,
 * whatever serves it. Unset, the site answers exactly as before: only the SPA
 * routes the allow-list in frontend/Caddyfile leaves out are noindex.
 *
 * Runs the real Caddyfile against a stand-in backend, like
 * app-search-indexing.test.mjs; skipped without a Caddy binary (CI installs
 * the image's version; set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

async function withSite(env, run) {
  const temp = mkdtempSync(join(tmpdir(), "robots-noindex-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")
  writeFileSync(join(dist, "assets", "index-Abc.js"), "export {}")
  writeFileSync(join(dist, "config.js"), "window.__NODARO_RUNTIME__={};")
  const backend = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end('{"ok":true}')
  })
  const backendPort = await listen(backend)
  const probe = createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  const config = join(temp, "Caddyfile")
  writeFileSync(
    config,
    readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
      .replace(":3000 {", `:${port} {`)
      .replaceAll("/app/frontend/dist", dist)
      .replaceAll("127.0.0.1:9000", `127.0.0.1:${backendPort}`),
  )
  const child = spawn(CADDY, ["run", "--config", config, "--adapter", "caddyfile"], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  })
  let logs = ""
  child.stderr.on("data", (data) => {
    logs += data
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    await response.text()
    return response
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fetch(`http://127.0.0.1:${port}/config.js`)
        break
      } catch {
        if (child.exitCode !== null) assert.fail(logs)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    await run(get, logs)
  } finally {
    child.kill("SIGTERM")
    await exited
    backend.closeAllConnections()
    await new Promise((resolve) => backend.close(resolve))
    rmSync(temp, { recursive: true })
  }
}

// Every kind of response the site gives: an API answer, a build file, an indexable page, an un-indexed page, a 404.
const EVERY_KIND = ["/v1/health", "/assets/index-Abc.js", "/gallery", "/projects", "/fonts/gone.woff2", "/config.js"]

test("ROBOTS_NOINDEX=true marks every response noindex; anything else leaves the site as it was", { skip: !available }, async () => {
  await withSite({ ROBOTS_NOINDEX: "true" }, async (get) => {
    for (const path of EVERY_KIND) {
      const res = await get(path)
      assert.equal(res.headers.get("x-robots-tag"), "noindex", `${path} must be noindex on a noindex deployment`)
    }
  })

  // Unset: exactly today's behaviour.
  await withSite({}, async (get) => {
    const expectations = [
      ["/v1/health", null],
      ["/assets/index-Abc.js", null],
      ["/gallery", null],
      ["/projects", "noindex"],
    ]
    for (const [path, value] of expectations) {
      const res = await get(path)
      assert.equal(res.headers.get("x-robots-tag"), value, `${path} with ROBOTS_NOINDEX unset`)
    }
  })

  // A typo or any other value never breaks the boot and changes nothing: not
  // even a quote or a backslash, which the old text substitution put inside
  // the expression and so stopped Caddy from starting.
  for (const value of ["1", 'tr"ue', "tr\\ue", '"', "\\"]) {
    await withSite({ ROBOTS_NOINDEX: value }, async (get) => {
      const res = await get("/gallery")
      assert.equal(res.headers.get("x-robots-tag"), null, `ROBOTS_NOINDEX=${value}`)
    })
  }
})
