import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Which app pages search engines may index. robots.txt names no sitemap (the
 * app has none; the SPA would answer /sitemap.xml with its HTML shell), and
 * the Caddyfile marks every SPA route noindex except an allow-list of public
 * pages. The second test runs the real Caddyfile, like
 * managed-supabase-proxy.test.mjs, and is skipped where no Caddy binary is
 * available (set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

test("robots.txt names no sitemap: the app serves none", () => {
  const robots = readFileSync(new URL("../../frontend/public/robots.txt", import.meta.url), "utf8")
  assert.doesNotMatch(robots, /^\s*Sitemap:/im)
})

test("Caddy marks private SPA routes noindex and leaves the public pages indexable", { skip: !available }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "app-noindex-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")
  writeFileSync(join(dist, "robots.txt"), readFileSync(new URL("../../frontend/public/robots.txt", import.meta.url)))
  writeFileSync(join(dist, "assets", "app.js"), "export {}")

  const portProbe = createServer()
  const port = await listen(portProbe)
  await new Promise(resolve => portProbe.close(resolve))
  const config = join(temp, "Caddyfile")
  writeFileSync(
    config,
    readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
      .replace(":3000 {", `:${port} {`)
      .replaceAll("/app/frontend/dist", dist),
  )
  const child = spawn(CADDY, ["run", "--config", config, "--adapter", "caddyfile"], { stdio: ["ignore", "ignore", "pipe"] })
  let logs = ""
  child.stderr.on("data", data => { logs += data })
  const exited = new Promise(resolve => child.once("exit", resolve))
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(`http://127.0.0.1:${port}/robots.txt`); break } catch {
        if (child.exitCode !== null) assert.fail(logs)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    const robotsTag = async path => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      await response.arrayBuffer()
      return response.headers.get("x-robots-tag")
    }

    for (const path of [
      "/projects",
      "/projects/p1/workflows/w1",
      "/settings/api",
      "/present/share-token",
      "/embed/some-app",
      "/mcp",
      "/pricing",
      "/oauth/authorize",
      "/admin",
      "/no-such-page",
    ]) {
      assert.equal(await robotsTag(path), "noindex", `${path} should carry X-Robots-Tag: noindex`)
    }

    for (const path of ["/", "/login", "/signup", "/gallery", "/app/some-app", "/tutorials/first-flow", "/robots.txt", "/assets/app.js"]) {
      assert.equal(await robotsTag(path), null, `${path} should stay indexable`)
    }
  } finally {
    child.kill("SIGTERM")
    await exited
    rmSync(temp, { recursive: true, force: true })
  }
})
