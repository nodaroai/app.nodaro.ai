import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The trend catalog's answers choose their own Cache-Control (a guest's may be
 * kept a day at the edge, backend/src/ee/lib/trends/public-read.ts), so under
 * /v1/trends the Caddyfile's `no-cache` is only a default: an answer with its
 * own header keeps it alone, one without gets `no-cache`. Everywhere else the
 * shell's `no-cache` is still added as before — the SPA shell must never be
 * kept, and the rest of the API is left as it was.
 *
 * Runs the real Caddyfile against a stand-in backend, like
 * site-assets-caddy.test.mjs; skipped without a Caddy binary (CI installs the
 * image's version; set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
const GUEST = "public, max-age=60, s-maxage=86400"
const OWN = "public, max-age=60"

/** Each path answers with the Cache-Control a backend route would set (none for the runs list's refusal). */
function standInBackend() {
  return createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]
    const own = {
      "/v1/trends": GUEST,
      "/v1/trends/tags": GUEST,
      "/v1/trends/neon-dance": GUEST,
      "/v1/trendsX": OWN,
      "/v1/keepers/catalog": OWN,
    }[path]
    res.writeHead(path === "/v1/trends/runs" ? 401 : 200, { "content-type": "application/json", ...(own ? { "cache-control": own } : {}) })
    res.end("{}")
  })
}

test("under /v1/trends an answer's own Cache-Control stands alone, and no-cache is only a default there", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "trend-reads-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")

  const backend = standInBackend()
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
  const cacheControl = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).headers.get("cache-control")
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

    // A guest's catalog, tags and trend page: the backend's header alone, with or without a query.
    for (const path of ["/v1/trends", "/v1/trends?locale=he&limit=20", "/v1/trends/tags", "/v1/trends/neon-dance?locale=en"]) {
      assert.equal(await cacheControl(path), GUEST, path)
    }
    // An answer under /v1/trends that sets none still gets the default.
    assert.equal(await cacheControl("/v1/trends/runs"), "no-cache")

    // Everywhere else, as before: the shell's no-cache is added (beside a route's own header).
    assert.equal(await cacheControl("/projects/123"), "no-cache")
    for (const path of ["/v1/keepers/catalog", "/v1/trendsX"]) {
      const value = await cacheControl(path)
      assert.match(value ?? "", /no-cache/, `${path} keeps the added no-cache`)
      assert.match(value ?? "", /max-age=60/, `${path} keeps its own header too`)
    }
  } finally {
    child.kill()
    await exited
    await new Promise((resolve) => backend.close(resolve))
    rmSync(temp, { recursive: true, force: true })
  }
})
