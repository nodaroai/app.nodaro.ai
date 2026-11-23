import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A workflow's view link, /view/<token>: link-preview readers and search
 * engines get its card (GET /og/view/:token, backend/src/routes/workflow-views.ts),
 * which says the robots rule its owner chose — so the page rules (the SPA
 * shell's no-cache, its noindex, the prerender header) leave that answer out,
 * and the card's own header reaches the reader once, whichever way the owner
 * set the switch. A person gets the canvas page: the SPA, noindex as ever. The
 * embed (/embed/view/<token>) is the SPA for every caller.
 *
 * Runs the real Caddyfile against a stand-in backend, like
 * share-card-caddy.test.mjs; skipped without a Caddy binary (CI installs the
 * image's version; set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
const INDEXED = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const HIDDEN = "ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-edcba"
const CARD_CACHE = "public, max-age=300"

test("/view/<token> is the card for readers and search engines, the canvas page for people", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "view-card-"))
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")

  const seen = []
  const backend = createServer((req, res) => {
    seen.push({ url: req.url, secret: req.headers["x-internal-orchestrator-secret"] })
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": CARD_CACHE,
      // The owner's switch, as the card route says it.
      "x-robots-tag": req.url.includes(INDEXED) ? "all" : "noindex",
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

    for (const agent of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "WhatsApp/2.23", "facebookexternalhit/1.1", "Twitterbot/1.0"]) {
      for (const [token, robots] of [[INDEXED, "all"], [HIDDEN, "noindex"]]) {
        seen.length = 0
        const res = await fetch(`http://127.0.0.1:${port}/view/${token}`, { headers: { "user-agent": agent, "x-internal-orchestrator-secret": "forged" } })
        assert.equal(res.status, 200, agent)
        assert.equal(await res.text(), `<!doctype html><title>card /og/view/${token}</title>`, agent)
        assert.equal(seen[0]?.secret, undefined, "the internal secret never reaches the backend")
        // The card's own headers, once each.
        assert.equal(res.headers.get("x-robots-tag"), robots, `${agent} ${token}`)
        assert.equal(res.headers.get("cache-control"), CARD_CACHE, agent)
        assert.equal(res.headers.get("supports-loading-mode"), null, agent)
        assert.match(res.headers.get("vary") ?? "", /User-Agent/, agent)
      }
    }

    // A person gets the canvas page, never indexed; so does every embed.
    for (const path of [`/view/${INDEXED}`, `/embed/view/${INDEXED}`]) {
      seen.length = 0
      const page = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "user-agent": "Mozilla/5.0 (iPhone)" } })
      assert.match(await page.text(), /Nodaro\.ai/, path)
      assert.equal(page.headers.get("x-robots-tag"), "noindex", path)
      if (path.startsWith("/view/")) assert.match(page.headers.get("vary") ?? "", /User-Agent/, path)
      assert.equal(seen.length, 0, path)
    }
    const embedBot = await fetch(`http://127.0.0.1:${port}/embed/view/${INDEXED}`, { headers: { "user-agent": "Googlebot/2.1" } })
    assert.match(await embedBot.text(), /Nodaro\.ai/)
    assert.equal(embedBot.headers.get("x-robots-tag"), "noindex")
  } finally {
    child.kill()
    await exited
    await new Promise((resolve) => backend.close(resolve))
    rmSync(temp, { recursive: true, force: true })
  }
})
