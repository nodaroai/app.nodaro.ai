import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The move of the app's pages to their own host (frontend/Caddyfile, generated
 * block from frontend/src/route-homes.json).
 *
 * With LEGACY_UI_HOSTS + FLOW_UI_ORIGIN set, a top-level visit to a moved page
 * on a named legacy host answers one 302 (no-store) to the same path and query
 * on the Flow origin; kept pages, files, the API and framed loads are served.
 * On the Flow host, top-level visits to the public pages that stay on the
 * legacy host (/app/*, /embed/*, /present/*) go back to PUBLIC_URL. A host the
 * settings do not name, and any install without them, answers as before.
 *
 * Real Caddyfile, stand-in backend, like app-search-indexing.test.mjs; skipped
 * without a Caddy binary (CI installs the image's version; CADDY_BIN points at one).
 */

const CADDY = process.env.CADDY_BIN ?? "caddy"
const available = spawnSync(CADDY, ["version"]).status === 0
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

const LEGACY = "app.example.test"
const FLOW_ORIGIN = "https://flow.example.test"
const FLOW = "flow.example.test"
const ON = {
  LEGACY_UI_HOSTS: LEGACY,
  FLOW_UI_ORIGIN: FLOW_ORIGIN,
  PUBLIC_URL: `https://${LEGACY}`,
}

async function withSite(env, run) {
  const temp = mkdtempSync(join(tmpdir(), "legacy-ui-"))
  // Caddy on Windows reads forward slashes; elsewhere they are already the separator.
  const dist = join(temp, "dist").replace(/\\/g, "/")
  mkdirSync(join(dist, "assets"), { recursive: true })
  mkdirSync(join(dist, "fonts"), { recursive: true })
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Nodaro.ai</title>")
  writeFileSync(join(dist, "assets", "index-Abc.js"), "export {}")
  writeFileSync(join(dist, "fonts", "geist.woff2"), "wOF2")
  writeFileSync(join(dist, "robots.txt"), "User-agent: *")
  writeFileSync(join(dist, "embed.js"), "// embed")
  writeFileSync(join(dist, "config.js"), "window.__NODARO_RUNTIME__={};")
  // Another app served on this host, the way a deployment's image adds one (sites.d).
  const sites = join(temp, "sites.d").replace(/\\/g, "/")
  mkdirSync(sites, { recursive: true })
  writeFileSync(join(sites, "tools.caddy"), "handle /tools/* {\n\trespond \"tools {path}\" 200\n}\n")
  const backend = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ url: req.url }))
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
      .replaceAll("127.0.0.1:9000", `127.0.0.1:${backendPort}`)
      .replace("import /etc/caddy/sites.d/*.caddy", `import ${sites}/*.caddy`),
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
  // fetch() may not set Host, and sends Sec-Fetch-* itself; a plain request says exactly what a test names.
  const get = (path, { host = LEGACY, headers = {}, method = "GET" } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method, headers: { Host: host, ...headers }, setHost: false }, (res) => {
        let body = ""
        res.on("data", (chunk) => (body += chunk))
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }))
      })
      req.on("error", reject)
      req.end()
    })
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await get("/config.js", { host: "127.0.0.1" })
        break
      } catch {
        if (child.exitCode !== null) assert.fail(logs)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    await run(get, () => logs)
  } finally {
    child.kill("SIGTERM")
    await exited
    backend.closeAllConnections()
    await new Promise((resolve) => backend.close(resolve))
    rmSync(temp, { recursive: true })
  }
}

const MOVED = ["/", "/projects", "/projects/123", "/editor/abc?nodeId=1", "/billing", "/settings/api", "/usage", "/gallery", "/pricing", "/mcp", "/join/abc.def"]
const KEPT = ["/login", "/signup", "/auth/callback", "/sso", "/oauth/authorize?client_id=x", "/auth/cli", "/app/my-app", "/embed/my-app", "/embed/scene3d", "/present/token", "/checkout-complete"]

test("on a named legacy host, a moved page goes to the Flow host, kept pages and everything else stay", { skip: !available }, async () => {
  await withSite(ON, async (get, logs) => {
    for (const path of MOVED) {
      const res = await get(path)
      assert.equal(res.status, 302, `${path} ${logs()}`)
      assert.equal(res.headers.location, `${FLOW_ORIGIN}${path}`, path)
      assert.equal(res.headers["cache-control"], "no-store", `${path}: one Cache-Control, no-store`)
      assert.match(res.headers.vary ?? "", /sec-fetch-dest/i, `${path} carries Vary: Sec-Fetch-Dest (a cached 301 must not answer a framed load)`)
    }
    // The query string travels with the path.
    assert.equal((await get("/editor/abc?nodeId=1&x=2")).headers.location, `${FLOW_ORIGIN}/editor/abc?nodeId=1&x=2`)

    for (const path of KEPT) {
      const res = await get(path)
      assert.equal(res.status, 200, `${path} stays on the kept host`)
      assert.equal(res.headers.location, undefined, path)
    }
    // Plumbing and files.
    assert.equal((await get("/v1/anything")).status, 200)
    assert.deepEqual(JSON.parse((await get("/v1/anything?a=1")).body), { url: "/v1/anything?a=1" })
    assert.equal((await get("/.well-known/oauth-authorization-server")).status, 200)
    assert.equal((await get("/config.js")).status, 200)
    assert.equal((await get("/robots.txt")).body, "User-agent: *")
    assert.equal((await get("/embed.js")).status, 200)
    assert.equal((await get("/assets/index-Abc.js")).status, 200)
    assert.equal((await get("/fonts/geist.woff2")).status, 200)
    assert.equal((await get("/fonts/gone.woff2")).status, 404, "a missing file stays a 404 nobody caches, not a redirect")
    assert.equal((await get("/assets/old.css")).status, 200, "the archive answers, not the redirect")

    // POST to /mcp keeps its machine-readable answer; a form POST to a page is not moved.
    assert.equal((await get("/mcp", { method: "POST" })).status, 405)
    assert.equal((await get("/projects", { method: "POST" })).headers.location, undefined)

    // Framed loads of account pages: served, so every product's account pop-up keeps working.
    for (const dest of ["iframe", "frame", "embed", "object"]) {
      const framed = await get("/billing", { headers: { "Sec-Fetch-Dest": dest } })
      assert.equal(framed.status, 200, `Sec-Fetch-Dest: ${dest}`)
      assert.equal(framed.headers.location, undefined, dest)
    }
    assert.equal((await get("/billing", { headers: { "Sec-Fetch-Dest": "document" } })).status, 302)
    // A crawler or old browser sends no such header: redirected.
    assert.equal((await get("/billing")).status, 302)

    // Another host (the same image for another deployment) is untouched.
    const elsewhere = await get("/projects", { host: "sai.example.test" })
    assert.equal(elsewhere.status, 200)
    assert.equal(elsewhere.headers.location, undefined)
  })
})

test("LEGACY_UI_REDIRECT_STATUS=301 is a permanent move with a one-hour browser cache; anything else stays 302", { skip: !available }, async () => {
  await withSite({ ...ON, LEGACY_UI_REDIRECT_STATUS: "301" }, async (get, logs) => {
    const res = await get("/projects")
    assert.equal(res.status, 301, logs())
    assert.equal(res.headers.location, `${FLOW_ORIGIN}/projects`)
    assert.equal(res.headers["cache-control"], "private, max-age=3600")
    assert.match(res.headers.vary ?? "", /sec-fetch-dest/i)
  })
  await withSite({ ...ON, LEGACY_UI_REDIRECT_STATUS: "banana" }, async (get) => {
    const res = await get("/projects")
    assert.equal(res.status, 302, "an invalid value falls back to the safe 302")
    assert.equal(res.headers["cache-control"], "no-store")
  })
})

test("on the Flow host, the public pages that live on the kept host go back there; everything else is served", { skip: !available }, async () => {
  await withSite(ON, async (get, logs) => {
    for (const path of ["/app/my-app?ref=1", "/embed/my-app", "/present/token"]) {
      const res = await get(path, { host: FLOW })
      assert.equal(res.status, 302, `${path} ${logs()}`)
      assert.equal(res.headers.location, `https://${LEGACY}${path}`, path)
      assert.equal(res.headers["cache-control"], "no-store", path)
    }
    // A framed embed on the Flow host is served where it is.
    assert.equal((await get("/embed/my-app", { host: FLOW, headers: { "Sec-Fetch-Dest": "iframe" } })).status, 200)
    // Pages of the Flow UI, the API and files answer here.
    for (const path of ["/projects", "/gallery", "/login", "/billing"]) {
      const res = await get(path, { host: FLOW })
      assert.equal(res.status, 200, path)
      assert.equal(res.headers.location, undefined, path)
    }
    assert.equal((await get("/v1/anything", { host: FLOW })).status, 200)
    assert.equal((await get("/assets/index-Abc.js", { host: FLOW })).status, 200)
    // A social-share bot on the Flow host still gets the OG page.
    const bot = await get("/app/my-app", { host: FLOW, headers: { "User-Agent": "TelegramBot (like TwitterBot)" } })
    assert.deepEqual(JSON.parse(bot.body), { url: "/og/app/my-app" })
    assert.equal(bot.status, 200)
  })
})

test("with no setting, or an incomplete one, every host answers as before", { skip: !available }, async () => {
  const hosts = [LEGACY, FLOW, "sai.example.test"]
  const paths = ["/", "/projects", "/billing", "/app/x", "/embed/y"]
  const incomplete = [
    {},
    { LEGACY_UI_HOSTS: LEGACY },
    { FLOW_UI_ORIGIN: FLOW_ORIGIN },
    { LEGACY_UI_HOSTS: LEGACY, FLOW_UI_ORIGIN: "not-an-origin", PUBLIC_URL: `https://${LEGACY}` },
    { LEGACY_UI_HOSTS: "", FLOW_UI_ORIGIN: FLOW_ORIGIN, PUBLIC_URL: `https://${LEGACY}` },
    // No kept origin, or the Flow origin as the kept one: the move is off, as the browser and the server read it.
    { ...ON, PUBLIC_URL: "" },
    { ...ON, PUBLIC_URL: `http://${LEGACY}` },
    { ...ON, PUBLIC_URL: `https://${LEGACY}/v1` },
    { ...ON, PUBLIC_URL: FLOW_ORIGIN },
  ]
  for (const env of incomplete) {
    await withSite(env, async (get, logs) => {
      for (const host of hosts) {
        for (const path of paths) {
          const res = await get(path, { host })
          assert.equal(res.status, 200, `${JSON.stringify(env)} ${host}${path} ${logs()}`)
          assert.equal(res.headers.location, undefined, `${JSON.stringify(env)} ${host}${path}`)
        }
      }
    })
  }
})

test("a misconfiguration can never make a loop or a same-host redirect", { skip: !available }, async () => {
  // LEGACY_UI_HOSTS names the Flow host itself: refused, the site keeps working.
  await withSite({ LEGACY_UI_HOSTS: FLOW, FLOW_UI_ORIGIN: FLOW_ORIGIN, PUBLIC_URL: `https://${LEGACY}` }, async (get) => {
    const res = await get("/projects", { host: FLOW })
    assert.equal(res.status, 200)
    assert.equal(res.headers.location, undefined)
  })
  // PUBLIC_URL equals the Flow origin (no separate kept host): nothing moves either way.
  await withSite({ LEGACY_UI_HOSTS: LEGACY, FLOW_UI_ORIGIN: FLOW_ORIGIN, PUBLIC_URL: FLOW_ORIGIN }, async (get) => {
    for (const [path, host] of [["/app/x", FLOW], ["/projects", LEGACY]]) {
      const res = await get(path, { host })
      assert.equal(res.status, 200, `${host}${path}`)
      assert.equal(res.headers.location, undefined)
    }
  })
})

const ADDRESSES = JSON.parse(readFileSync(new URL("./fixtures/route-home-addresses.json", import.meta.url), "utf8")).addresses

test("the shared address table: Caddy decides every address as the table says, on both hosts", { skip: !available }, async () => {
  await withSite(ON, async (get, logs) => {
    for (const { path, legacy, flow } of ADDRESSES) {
      const onLegacy = await get(path)
      if (legacy === "move") {
        assert.equal(onLegacy.status, 302, `${path} on the legacy host should move ${logs()}`)
        assert.equal(onLegacy.headers.location, `${FLOW_ORIGIN}${path}`, path)
      } else {
        assert.equal(onLegacy.headers.location, undefined, `${path} on the legacy host should stay`)
      }
      const onFlow = await get(path, { host: FLOW })
      if (flow === "back") {
        assert.equal(onFlow.status, 302, `${path} on the Flow host should go back`)
        assert.equal(onFlow.headers.location, `https://${LEGACY}${path}`, path)
      } else {
        assert.equal(onFlow.headers.location, undefined, `${path} on the Flow host should stay`)
      }
    }
    // Another app's route (sites.d) is answered by that app, never moved.
    assert.equal((await get("/tools/x")).body, "tools /tools/x")
  })
})

test("a quote or a backslash in any setting never stops Caddy from starting", { skip: !available }, async () => {
  for (const name of ["LEGACY_UI_HOSTS", "FLOW_UI_ORIGIN", "LEGACY_UI_REDIRECT_STATUS", "PUBLIC_URL"]) {
    for (const bad of ['a"b', "a\\b"]) {
      await withSite({ ...ON, [name]: bad }, async (get) => {
        const res = await get("/login")
        assert.equal(res.status, 200, `${name}=${bad}: Caddy runs and serves`)
      })
    }
  }
})

test("a trailing slash on FLOW_UI_ORIGIN or PUBLIC_URL is the same origin", { skip: !available }, async () => {
  await withSite({ ...ON, FLOW_UI_ORIGIN: `${FLOW_ORIGIN}/`, PUBLIC_URL: `https://${LEGACY}/` }, async (get) => {
    assert.equal((await get("/projects")).headers.location, `${FLOW_ORIGIN}/projects`)
    assert.equal((await get("/app/x", { host: FLOW })).headers.location, `https://${LEGACY}/app/x`)
  })
})

test("hosts are split by one rule: commas or spaces, any letter case", { skip: !available }, async () => {
  await withSite({ ...ON, LEGACY_UI_HOSTS: " Other.Test ,APP.EXAMPLE.TEST" }, async (get) => {
    assert.equal((await get("/projects")).status, 302)
    assert.equal((await get("/projects", { host: "other.test" })).status, 302)
  })
})

test("a 301 is cached only by the browser, for an hour", { skip: !available }, async () => {
  await withSite({ ...ON, LEGACY_UI_REDIRECT_STATUS: "301" }, async (get) => {
    assert.equal((await get("/projects")).headers["cache-control"], "private, max-age=3600")
    assert.equal((await get("/app/x", { host: FLOW })).headers["cache-control"], "private, max-age=3600")
  })
})
