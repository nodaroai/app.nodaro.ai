import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A share link's address, /s/<token>, is its card: the bundled proxy hands
 * every request there to the backend's card route (GET /og/s/:token,
 * backend/src/routes/share-card.ts), for every caller — the card is what a
 * link preview reads and what sends people on to the share page. The card
 * sets its own headers, so the page rules (the SPA shell's no-cache, its
 * noindex, the prerender header) leave it alone, and the internal-call
 * headers never reach the backend from outside.
 *
 * Runs the real Caddyfile against a stand-in backend, like
 * trend-reads-caddy.test.mjs; skipped without a Caddy binary (CI installs the
 * image's version; set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const CARD_CACHE = "public, max-age=300"

test("the Caddyfile hands /s/* to the backend's card route, and leaves it out of the page rules", () => {
  const caddyfile = readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
  const block = caddyfile.match(/handle \/s\/\* \{([\s\S]*?)\n\t\}/)?.[1] ?? ""
  assert.match(block, /rewrite \* \/og\{uri\}/)
  assert.match(block, /reverse_proxy 127\.0\.0\.1:9000/)
  assert.match(block, /request_header -X-Internal-Orchestrator-Secret/)
  for (const matcher of ["@html", "@spa_document", "@spa_noindex"]) {
    const rules = caddyfile.slice(caddyfile.indexOf(`${matcher} {`), caddyfile.indexOf("}", caddyfile.indexOf(`${matcher} {`)))
    assert.match(rules, /not path [^\n]*\/s\/\*/, `${matcher} leaves /s/* out`)
  }
})

test("/s/<token> is the backend's card, with its own headers alone", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "share-card-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")

  const seen = []
  const backend = createServer((req, res) => {
    seen.push({ url: req.url, secret: req.headers["x-internal-orchestrator-secret"] })
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": CARD_CACHE,
      "x-robots-tag": "noindex",
    })
    res.end(`<!doctype html><title>card ${req.url}</title>`)
  })
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

    // A browser and a preview reader alike, the secret header dropped on the way.
    for (const agent of ["Mozilla/5.0", "Twitterbot/1.0", "facebookexternalhit/1.1"]) {
      seen.length = 0
      const res = await fetch(`http://127.0.0.1:${port}/s/${TOKEN}?utm_source=x`, {
        headers: { "user-agent": agent, "x-internal-orchestrator-secret": "forged" },
      })
      const body = await res.text()
      assert.equal(res.status, 200, agent)
      assert.equal(body, `<!doctype html><title>card /og/s/${TOKEN}?utm_source=x</title>`, agent)
      assert.equal(seen[0]?.url, `/og/s/${TOKEN}?utm_source=x`)
      assert.equal(seen[0]?.secret, undefined, "the internal secret never reaches the backend")
      // Its own headers, once each: no shell no-cache, no second noindex, no prerender header.
      assert.equal(res.headers.get("cache-control"), CARD_CACHE, agent)
      assert.equal(res.headers.get("x-robots-tag"), "noindex", agent)
      assert.equal(res.headers.get("supports-loading-mode"), null, agent)
    }

    // The bare /s and the app's pages are still the SPA.
    seen.length = 0
    const shell = await fetch(`http://127.0.0.1:${port}/s`)
    assert.match(await shell.text(), /Nodaro\.ai/)
    assert.equal(seen.length, 0)
  } finally {
    child.kill()
    await exited
    await new Promise((resolve) => backend.close(resolve))
    rmSync(temp, { recursive: true, force: true })
  }
})
