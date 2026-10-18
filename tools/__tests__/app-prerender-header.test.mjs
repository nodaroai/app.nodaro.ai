import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Another Nodaro surface on the same site may prerender this app before a
 * click (a speculation rule). Chrome activates a same-site, cross-origin
 * prerender only when the document says it may be prerendered with
 * credentials: `Supports-Loading-Mode: credentialed-prerender` on the SPA's
 * HTML. Hashed assets need nothing. The app holds its one-shot actions until
 * activation (frontend/src/lib/prerender.ts).
 *
 * Runs the real Caddyfile, like app-search-indexing.test.mjs; skipped without
 * a Caddy binary (set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

/** Not documents: the API and the proxies. None may carry the header. */
const NOT_DOCUMENTS = ["/v1/anything", "/supabase/rest/v1/x", "/storage/x", "/mcp", "/og/x", "/.well-known/oauth-authorization-server"]
const DOCUMENTS = ["/", "/projects", "/projects/abc/workflows/def", "/editor/abc", "/index.html", "/login"]
const EXCLUDED_PREFIXES = ["/assets/*", "/v1/*", "/.well-known/*", "/storage/*", "/supabase/*", "/og/*", "/mcp*"]

test("the Caddyfile sends it from a documents-only matcher that leaves the API and the proxies out", () => {
  const caddyfile = readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
  assert.match(caddyfile, /^\s*header @spa_document Supports-Loading-Mode "credentialed-prerender"\s*$/m)
  assert.doesNotMatch(caddyfile, /header @html Supports-Loading-Mode/)
  const block = caddyfile.match(/@spa_document \{([\s\S]*?)\n\s*\}/)?.[1] ?? ""
  assert.ok(block.includes("^([^.]*|/.*\\.html)$"), "@spa_document must match the SPA's document paths")
  const excluded = (block.match(/^\s*not path (.+)$/m)?.[1] ?? "").trim().split(/\s+/)
  for (const prefix of EXCLUDED_PREFIXES) assert.ok(excluded.includes(prefix), `@spa_document must exclude ${prefix}`)
})

test("Caddy sends Supports-Loading-Mode on SPA documents only — not on assets, the API or the proxies", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "app-prerender-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")
  writeFileSync(join(dist, "assets", "app-abc123.js"), "export {}")
  const portProbe = createServer()
  const port = await listen(portProbe)
  await new Promise((resolve) => portProbe.close(resolve))
  const config = join(temp, "Caddyfile")
  writeFileSync(
    config,
    readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
      .replace(":3000 {", `:${port} {`)
      .replaceAll("/app/frontend/dist", dist),
  )
  const child = spawn(CADDY, ["run", "--config", config, "--adapter", "caddyfile"], { stdio: ["ignore", "ignore", "pipe"] })
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
    const mode = async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      await response.arrayBuffer()
      return response.headers.get("supports-loading-mode")
    }
    for (const path of DOCUMENTS) assert.equal(await mode(path), "credentialed-prerender", path)
    // A hashed asset, the API and every proxy (answered here with an error,
    // there being no backend): never.
    for (const path of ["/assets/app-abc123.js", ...NOT_DOCUMENTS]) assert.equal(await mode(path), null, path)
  } finally {
    child.kill()
    await exited
    rmSync(temp, { recursive: true, force: true })
  }
})
