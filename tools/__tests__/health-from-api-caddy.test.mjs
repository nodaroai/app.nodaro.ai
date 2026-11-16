import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import { createServer as createTcpServer } from "node:net"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * GET /health on the public port is the container's health address. It is the
 * API server's own answer: 200 with the API's JSON while the API is up, and the
 * proxy's failure status while the API is down, still starting or hung. Never
 * the app's page, which answered 200 whenever the proxy was up: on 2026-11-15
 * the API server ran out of heap, the proxy answered 502 on every API call for
 * nine minutes, and the health address stayed green the whole time.
 *
 * Every other spelling of the address itself (a trailing slash, `;`
 * parameters, either one percent-encoded, another letter case, dot segments)
 * is rewritten to /health, so it reads the same real status. A path under it
 * (/health/x) goes to the API as sent, which refuses it (401: no route there is
 * public): an honest failure. A dot-segment path that leaves the address
 * (/health/../v1/x) is never rewritten. None of them is ever the app's page.
 *
 * The same image serves several hosts (the app, the app's pages on a host of
 * their own, a self-host install), and the host rules (page moves, canonical
 * links, search-indexing and prerender headers, link-preview bots) must leave
 * the address to the API on every one of them.
 *
 * Runs the real Caddyfile against a stand-in API, like
 * site-assets-caddy.test.mjs; skipped without a Caddy binary (CI installs the
 * image's version; set CADDY_BIN to point at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const CADDYFILE = readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8")
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

const LEGACY = "app.example.test"
const FLOW = "flow.example.test"
const FLOW_ORIGIN = `https://${FLOW}`
/** The app's pages on a host of their own, with the old host redirecting them: every host rule is on. */
const PAGES_MOVED = { LEGACY_UI_HOSTS: LEGACY, FLOW_UI_ORIGIN: FLOW_ORIGIN, PUBLIC_URL: `https://${LEGACY}` }
/** The hosted app, the Flow host, a self-host install, and a host no setting names. */
const HOSTS = [LEGACY, FLOW, "localhost:3000", "other.example.test"]
/** Other spellings of the address itself: each is rewritten to /health and reads its real status. */
const HEALTH_SPELLINGS = ["/health/", "/health//", "/health%2f", "/health%2F", "/health;x", "/health;", "/health%3bx", "/HEALTH", "/Health/", "//health", "/./health", "/health/.", "/health/%2e", "/x/../health", "/health;x.js", "/health;.css", "/health;../v1/x"]
/** Paths under the address: not it, so they go to the API as sent and fail honestly. */
const UNDER_HEALTH = ["/health/x", "/health/x/y", "/health%2fx", "/health///x", "/health/x.js"]
/** Dot segments that leave the address: never rewritten, they reach the API exactly as sent, as before. */
const TRAVERSALS = ["/health/../v1/secret", "/health/%2e%2e/v1/secret", "/health/.%2e/v1/secret", "/health/..%2fv1%2fsecret", "/health%2f..%2fv1%2fsecret", "/health/%2e%2e%2fv1/secret", "/health;/../v1/secret", "/health;x/../../v1/secret"]
/** A port nothing listens on, the repo's usual "refuses at once" address (Caddyfile, community-e2e.yml). */
const REFUSING_PORT = 9

/** What the API's GET /health answers (backend/src/routes/health.ts). */
const API_ANSWER = { status: "healthy", timestamp: "2026-11-16T00:00:00.000Z", version: "1.2.3" }

/**
 * A stand-in API: records what reached it, answers /health with `status`, and
 * refuses anything else 401, as the API's auth hook does for a path no public
 * route serves (checked against the real API behind this Caddyfile).
 */
function standInApi(asked, status = 200) {
  return createServer((req, res) => {
    asked.push({ method: req.method, url: req.url, headers: req.headers })
    if (req.url === "/health" || req.url.startsWith("/health?")) {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...API_CACHE_CONTROL })
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(status === 200 ? API_ANSWER : { error: "unavailable" }))
      return
    }
    res.writeHead(401, { "content-type": "application/json; charset=utf-8", ...API_CACHE_CONTROL })
    res.end(req.method === "HEAD" ? undefined : '{"error":{"code":"unauthorized"}}')
  })
}

/** A caching header of the API's own, which the health rule must replace, never sit beside. */
const API_CACHE_CONTROL = { "cache-control": "public, max-age=60" }

/** A stalled API: it accepts the connection and never answers. */
function hungApi() {
  const sockets = []
  const server = createTcpServer((socket) => {
    sockets.push(socket)
    socket.on("error", () => {})
  })
  const close = () => {
    for (const socket of sockets) socket.destroy()
    return new Promise((resolve) => server.close(resolve))
  }
  return { server, close }
}

async function freePort() {
  const probe = createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** The real Caddyfile on a free port, with its API at `apiPort`. */
async function withSite({ env = {}, apiPort }, run) {
  const temp = mkdtempSync(join(tmpdir(), "health-from-api-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")
  writeFileSync(join(dist, "config.js"), "window.__NODARO_RUNTIME__={};")
  const port = await freePort()
  const config = join(temp, "Caddyfile")
  writeFileSync(
    config,
    CADDYFILE.replace(":3000 {", `:${port} {`)
      .replaceAll("/app/frontend/dist", dist)
      .replaceAll("127.0.0.1:9000", `127.0.0.1:${apiPort}`),
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
  // fetch() may not set Host; a plain request says exactly what a test names.
  const get = (path, { host = LEGACY, headers = {}, method = "GET", timeoutMs = 20_000 } = {}) =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const req = request({ host: "127.0.0.1", port, path, method, headers: { Host: host, ...headers }, setHost: false }, (res) => {
        let body = ""
        res.on("data", (chunk) => (body += chunk))
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body, ms: Date.now() - started }))
      })
      req.setTimeout(timeoutMs, () => {
        req.destroy()
        resolve({ status: null, headers: {}, raw: [], body: "", ms: Date.now() - started })
      })
      req.on("error", reject)
      req.end()
    })
  try {
    // Up to 5 s for Caddy to listen: CI's tools job has one CPU.
    let listening = false
    for (let attempt = 0; attempt < 100 && !listening; attempt++) {
      try {
        await get("/config.js", { host: "127.0.0.1" })
        listening = true
      } catch {
        if (child.exitCode !== null) assert.fail(`Caddy exited before it listened:\n${logs}`)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    if (!listening) assert.fail(`Caddy did not listen on :${port} within 5 s:\n${logs}`)
    await run(get, () => logs)
  } finally {
    child.kill("SIGTERM")
    await exited
    rmSync(temp, { recursive: true, force: true })
  }
}

/** None of the page rules may touch the answer: no redirect, canonical, prerender or noindex header, never the app's page. */
function assertNoPageRule(res, label) {
  assert.equal(res.headers.location, undefined, `${label}: redirected to ${res.headers.location}`)
  assert.equal(res.headers.link, undefined, `${label}: carries a canonical link`)
  assert.equal(res.headers["supports-loading-mode"], undefined, `${label}: carries the prerender header of an app page`)
  assert.equal(res.headers["x-robots-tag"], undefined, `${label}: carries the noindex header of an app page`)
  assert.doesNotMatch(res.headers["content-type"] ?? "", /html/, `${label}: answered with HTML`)
  assert.doesNotMatch(res.body, /<title>Nodaro\.ai<\/title>/, `${label}: answered with the app's page`)
}

/**
 * Never stored: the app host sits behind a CDN, and a kept "healthy" would hide an outage. One
 * Cache-Control, no-store, on every answer of the rule: the API's, and Caddy's own 502 and 504.
 */
function assertNotStored(res, label) {
  const values = []
  for (let i = 0; i < res.raw.length; i += 2) if (res.raw[i].toLowerCase() === "cache-control") values.push(res.raw[i + 1])
  assert.deepEqual(values, ["no-store"], `${label}: Cache-Control ${JSON.stringify(values)}`)
}

/** The lines of the block a line opens, up to its closing brace, matched by counting braces. */
function block(text, opener) {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => opener.test(line))
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    const code = lines[i].replace(/(^|\s)#.*$/, "")
    depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length
    if (depth === 0) return lines.slice(start, i + 1).join("\n")
  }
  return null
}

test("the Caddyfile hands every spelling of /health to the API server, with a 5 s limit on this rule only", () => {
  const matcher = CADDYFILE.match(/^\s*@health_address\s+path\s+(.+)$/m)?.[1]?.trim().split(/\s+/)
  assert.deepEqual(matcher, ["/health", "/health/*", "/health;*"], "frontend/Caddyfile defines @health_address with the address and its spellings")
  const rule = block(CADDYFILE, /^\s*handle\s+@health_address\s*\{\s*$/)
  assert.ok(rule, "frontend/Caddyfile has a `handle @health_address { … }` block")
  // The address's own spellings are rewritten to the one literal path: the rewrite can name no other.
  assert.deepEqual(rule.match(/^\s*@health_spelling\s+path\s+(.+)$/m)?.[1]?.trim().split(/\s+/), ["/health", "/health/", "/health;*"])
  assert.match(rule, /^\s*rewrite\s+@health_spelling\s+\/health\s*$/m)
  assert.match(rule, /\breverse_proxy\s+127\.0\.0\.1:9000\s*\{/)
  // Never stored: the rule's own value on every answer, the API's dropped.
  assert.match(rule, /^\s*header\s+Cache-Control\s+"no-store"\s*$/m)
  assert.match(rule, /^\s*header_down\s+-Cache-Control\s*$/m)
  assert.match(rule, /^\s*import\s+client_ip_header\s*$/m)
  // Spoofed internal-auth headers never reach the API, as on every other route to it.
  assert.match(rule, /^\s*request_header\s+-X-Internal-Orchestrator\s*$/m)
  assert.match(rule, /^\s*request_header\s+-X-Internal-Orchestrator-Secret\s*$/m)
  // A stalled API answers within 5 s here, and nowhere else: /v1/* carries long event streams.
  assert.match(rule, /\btransport\s+http\s*\{[^}]*\bresponse_header_timeout\s+5s\b/)
  assert.equal(CADDYFILE.match(/\bresponse_header_timeout\b/g)?.length, 1, "the response limit is set on the health rule alone")
})

test("while the API is up, /health and every spelling of it read the API's own answer on every host; paths under it fail honestly", { skip: !available }, async () => {
  const asked = []
  const api = standInApi(asked)
  const apiPort = await listen(api)
  try {
    for (const env of [{}, PAGES_MOVED]) {
      await withSite({ env, apiPort }, async (get, logs) => {
        for (const host of HOSTS) {
          for (const headers of [{}, { "Sec-Fetch-Dest": "document" }, { "Sec-Fetch-Dest": "iframe" }, { "User-Agent": "TelegramBot (like TwitterBot)" }]) {
            const label = `${JSON.stringify(env)} ${host}/health ${JSON.stringify(headers)}`
            asked.length = 0
            const res = await get("/health", { host, headers })
            assert.equal(res.status, 200, `${label} ${logs()}`)
            assert.match(res.headers["content-type"] ?? "", /^application\/json/, label)
            assert.deepEqual(JSON.parse(res.body), API_ANSWER, label)
            assertNoPageRule(res, label)
            assertNotStored(res, label)
            assert.deepEqual(asked.map((a) => `${a.method} ${a.url}`), ["GET /health"], `${label}: reached the API once, as asked`)
          }
          // Every other spelling of the address reads the same real status, asked of the API as /health.
          for (const path of HEALTH_SPELLINGS) {
            const label = `${JSON.stringify(env)} ${host}${path}`
            asked.length = 0
            const res = await get(path, { host })
            assert.equal(res.status, 200, `${label} ${logs()}`)
            assert.deepEqual(JSON.parse(res.body), API_ANSWER, label)
            assertNoPageRule(res, label)
            assertNotStored(res, label)
            assert.deepEqual(asked.map((a) => `${a.method} ${a.url}`), ["GET /health"], `${label}: asked of the API as /health`)
          }
          // A path under the address is not it: the API gets it as sent and refuses it, never a 200.
          for (const path of [...UNDER_HEALTH, ...TRAVERSALS]) {
            const label = `${JSON.stringify(env)} ${host}${path}`
            asked.length = 0
            const res = await get(path, { host })
            assert.equal(res.status, 401, `${label} ${logs()}`)
            assertNoPageRule(res, label)
            // The traversals are answered by whichever rule their cleaned path matches (/v1/*), not this one.
            if (!TRAVERSALS.includes(path)) assertNotStored(res, label)
            assert.deepEqual(asked.map((a) => a.url), [path], `${label}: reached the API exactly as sent, never rewritten`)
          }
        }
        // HEAD (what some health checks send) and a query string reach the API as sent; a
        // rewritten spelling keeps its query and drops its `;` parameters.
        asked.length = 0
        const head = await get("/health", { method: "HEAD" })
        assert.equal(head.status, 200)
        assertNoPageRule(head, "HEAD /health")
        assertNotStored(head, "HEAD /health")
        const headSpelling = await get("/health/", { method: "HEAD" })
        assert.equal(headSpelling.status, 200)
        assertNotStored(headSpelling, "HEAD /health/")
        assert.equal((await get("/health?probe=1")).status, 200)
        assert.equal((await get("/health/?probe=2")).status, 200)
        assert.equal((await get("/health;x?probe=3")).status, 200)
        assert.deepEqual(asked.map((a) => `${a.method} ${a.url}`), ["HEAD /health", "HEAD /health", "GET /health?probe=1", "GET /health?probe=2", "GET /health?probe=3"])
        // Spoofed internal-auth headers are stripped; the client address reaches the API as the
        // proxy's one X-Forwarded-For entry (client_ip_header), never with the proxy appended.
        asked.length = 0
        await get("/health", { headers: { "X-Internal-Orchestrator": "1", "X-Internal-Orchestrator-Secret": "from-outside", "X-Forwarded-For": "203.0.113.9" } })
        assert.equal(asked[0].headers["x-internal-orchestrator"], undefined)
        assert.equal(asked[0].headers["x-internal-orchestrator-secret"], undefined)
        assert.equal(asked[0].headers["x-forwarded-for"], "203.0.113.9")
      })
    }
  } finally {
    api.closeAllConnections()
    await new Promise((resolve) => api.close(resolve))
  }
})

test("while the API is down or still starting, every spelling of /health is a 502 on every host, never the app's page", { skip: !available }, async () => {
  // Nothing listens on the API's port: a dead API server, or one still starting.
  for (const env of [{}, PAGES_MOVED]) {
    await withSite({ env, apiPort: REFUSING_PORT }, async (get, logs) => {
      for (const host of HOSTS) {
        for (const path of ["/health", ...HEALTH_SPELLINGS, ...UNDER_HEALTH]) {
          for (const method of ["GET", "HEAD"]) {
            const label = `${JSON.stringify(env)} ${method} ${host}${path}`
            const res = await get(path, { host, method })
            assert.equal(res.status, 502, `${label} ${logs()}`)
            assertNoPageRule(res, label)
            assertNotStored(res, label)
          }
        }
      }
      // The app's own pages are still served: only the health address reports the API.
      assert.equal((await get("/projects", { host: "localhost:3000" })).status, 200)
    })
  }
})

test("while the API is hung, /health fails within about 5 s on every host; the API's other routes keep no limit", { skip: !available }, async () => {
  const api = hungApi()
  const apiPort = await listen(api.server)
  try {
    await withSite({ env: PAGES_MOVED, apiPort }, async (get, logs) => {
      // All at once: each health read must fail on its own clock, not after the one before it.
      const health = HOSTS.flatMap((host) => ["/health", "/health/", "/health;x", "/health;x.js", "/health/x"].map((path) => ({ host, path })))
      const reads = health.map(({ host, path }) => get(path, { host, timeoutMs: 15_000 }).then((res) => ({ host, path, res })))
      // An API call through /v1/* (server-sent events stay open for minutes) is still waiting well past 5 s.
      const apiCall = get("/v1/anything", { timeoutMs: 7_000 })
      for (const { host, path, res } of await Promise.all(reads)) {
        const label = `${host}${path}`
        assert.ok(res.status === 502 || res.status === 504, `${label}: expected a 502/504, got ${res.status} after ${res.ms} ms ${logs()}`)
        assert.ok(res.ms >= 4_500 && res.ms < 10_000, `${label}: answered after ${res.ms} ms`)
        assertNoPageRule(res, label)
        assertNotStored(res, label)
      }
      const call = await apiCall
      assert.equal(call.status, null, `/v1/* was cut after ${call.ms} ms with ${call.status}: the 5 s limit must not reach it`)
    })
  } finally {
    await api.close()
  }
})

test("a failure the API answers itself reaches the health check as the API's status", { skip: !available }, async () => {
  const asked = []
  const api = standInApi(asked, 503)
  const apiPort = await listen(api)
  try {
    await withSite({ apiPort }, async (get) => {
      const res = await get("/health")
      assert.equal(res.status, 503)
      assert.deepEqual(JSON.parse(res.body), { error: "unavailable" })
      assertNoPageRule(res, "/health answered 503 by the API")
      assertNotStored(res, "/health answered 503 by the API")
    })
  } finally {
    api.closeAllConnections()
    await new Promise((resolve) => api.close(resolve))
  }
})
