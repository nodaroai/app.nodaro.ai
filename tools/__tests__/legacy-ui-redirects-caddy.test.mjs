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
// The pages have their own host, and nothing moves: every host keeps serving every page.
const OWN_HOST = {
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
  writeFileSync(join(dist, "storage-bridge.html"), "<!doctype html><title>bridge</title>")
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

/** A response as a browser would compare it: status, body and every header but the clock's. */
const answer = (res) => ({ status: res.status, body: res.body, headers: Object.fromEntries(Object.entries(res.headers).filter(([name]) => name !== "date")) })

test("the settings bridge page exists while the pages have their own host, with or without the move, framable only by the Flow origin", { skip: !available }, async () => {
  for (const env of [ON, { ...ON, FLOW_UI_ORIGIN: `${FLOW_ORIGIN}/` }, OWN_HOST, { ...ON, LEGACY_UI_HOSTS: "" }, { ...OWN_HOST, PUBLIC_URL: `https://${LEGACY}/` }]) {
    await withSite(env, async (get) => {
      for (const host of [LEGACY, FLOW]) {
        const res = await get("/storage-bridge.html", { host })
        assert.equal(res.status, 200, "served, never redirected")
        assert.equal(res.headers.location, undefined)
        assert.match(res.body, /<title>bridge<\/title>/)
        assert.equal(res.headers["content-security-policy"], `frame-ancestors ${FLOW_ORIGIN}`)
      }
    })
  }
})

test("without the pages' own host (unset, or a value the proxy cannot use), /storage-bridge.html answers exactly as an install without the file", { skip: !available }, async () => {
  for (const env of [{}, { LEGACY_UI_HOSTS: LEGACY, PUBLIC_URL: `https://${LEGACY}` }, { ...ON, FLOW_UI_ORIGIN: "*" }, { ...ON, FLOW_UI_ORIGIN: "https://*.example.test" }, { ...ON, PUBLIC_URL: `http://${LEGACY}` }, { ...ON, PUBLIC_URL: FLOW_ORIGIN }]) {
    await withSite(env, async (get) => {
      for (const host of [LEGACY, FLOW]) {
        const bridge = await get("/storage-bridge.html", { host })
        const unknown = await get("/no-such-page.html", { host })
        assert.deepEqual(answer(bridge), answer(unknown), `${JSON.stringify(env)} on ${host}`)
        assert.equal(bridge.headers["content-security-policy"], undefined)
        // Its trailing-slash forms too: no redirect to the file an install without it does not have.
        for (const [path, twin] of [["/storage-bridge.html/", "/no-such-page.html/"], ["/storage-bridge.html%2F", "/no-such-page.html%2F"], ["/Storage-Bridge.HTML/", "/No-Such-Page.HTML/"]]) {
          assert.deepEqual(answer(await get(path, { host })), answer(await get(twin, { host })), `${JSON.stringify(env)} ${host}${path}`)
        }
      }
    })
  }
})

test("with no setting, or an incomplete one, every host answers as before", { skip: !available }, async () => {
  const hosts = [LEGACY, FLOW, "sai.example.test"]
  const paths = ["/", "/projects", "/billing", "/app/x", "/embed/y"]
  const incomplete = [
    {},
    { LEGACY_UI_HOSTS: LEGACY },
    { FLOW_UI_ORIGIN: FLOW_ORIGIN },
    { LEGACY_UI_HOSTS: LEGACY, FLOW_UI_ORIGIN: "not-an-origin", PUBLIC_URL: `https://${LEGACY}` },
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

test("with the pages' own host alone, nothing redirects: every host serves every page", { skip: !available }, async () => {
  for (const env of [OWN_HOST, { ...OWN_HOST, LEGACY_UI_HOSTS: " , " }, { ...OWN_HOST, LEGACY_UI_REDIRECT_STATUS: "301" }]) {
    await withSite(env, async (get, logs) => {
      for (const host of [LEGACY, FLOW]) {
        for (const path of [...MOVED, ...KEPT]) {
          const res = await get(path, { host })
          assert.equal(res.status, 200, `${JSON.stringify(env)} ${host}${path} ${logs()}`)
          assert.equal(res.headers.location, undefined, `${host}${path}`)
        }
      }
    })
  }
})

const CANONICAL = (origin, path) => `<${origin}${path}>; rel="canonical"`

test("each page search engines may index names its one home as canonical, on both hosts, with or without the move", { skip: !available }, async () => {
  const kept = `https://${LEGACY}`
  const homes = [
    ["/", FLOW_ORIGIN],
    ["/gallery", FLOW_ORIGIN],
    ["/tutorials/getting-started", FLOW_ORIGIN],
    ["/login", kept],
    ["/signup", kept],
    ["/app/my-app", kept],
  ]
  for (const env of [OWN_HOST, ON, { ...OWN_HOST, FLOW_UI_ORIGIN: `${FLOW_ORIGIN}/`, PUBLIC_URL: `${kept}/` }]) {
    await withSite(env, async (get, logs) => {
      for (const host of [LEGACY, FLOW]) {
        for (const [path, home] of homes) {
          for (const method of ["GET", "HEAD"]) {
            const res = await get(path, { host, method })
            assert.equal(res.headers.link, CANONICAL(home, path), `${JSON.stringify(env)} ${method} ${host}${path} ${logs()}`)
          }
        }
      }
    })
  }
})

test("a canonical never carries the query, and only an address spelled exactly as listed gets one", { skip: !available }, async () => {
  await withSite(OWN_HOST, async (get) => {
    assert.equal((await get("/gallery?utm_source=x&tab=new")).headers.link, CANONICAL(FLOW_ORIGIN, "/gallery"))
    assert.equal((await get("/app/my-app-x1y2z3?run=1", { host: FLOW })).headers.link, CANONICAL(`https://${LEGACY}`, "/app/my-app-x1y2z3"))
    const none = [
      // Any character a header could misread, encoded or not.
      "/tutorials/a%20b", "/tutorials/a%3Eb", "/tutorials/a%22b", "/app/x%2Cy", "/tutorials/%C3%A9",
      // The proxy's path matchers see these cleaned (dot segments resolved, `//` merged, letter case ignored); the
      // header would write them as sent.
      "/tutorials/x%3E;%20rel=%22stylesheet%22,%20%3Chttps:%2F%2Fevil.test%2Fs.css%3E;%20rel=%22stylesheet%22,%20%3Cy%2F..%2F..%2F..%2Fok",
      "/gallery%2F..%2Fgallery", "/tutorials/x%2F..%2Fy", "//gallery", "/./", "/gallery/.", "/tutorials/./x", "/tutorials/x/..",
      "/Gallery", "/LOGIN", "/Tutorials/x", "/app/My-App",
      // Not a page: a file, a section's own root, a deeper path, an empty segment, a trailing slash.
      "/tutorials/missing.png", "/tutorials/", "/tutorials", "/tutorials/a/b", "/tutorials/a%2Fb", "/app//x", "/gallery/", "/login/",
    ]
    for (const path of none) {
      for (const host of [LEGACY, FLOW]) {
        const res = await get(path, { host })
        assert.equal(res.headers.link, undefined, `${host}${path}: ${res.headers.link}`)
      }
    }
  })
})

test("only the pages search engines may index name a canonical; nothing does without the pages' own host", { skip: !available }, async () => {
  await withSite(OWN_HOST, async (get) => {
    for (const path of ["/projects", "/gallery/", "/pricing", "/embed/x", "/present/t", "/settings/api", "/storage-bridge.html", "/robots.txt", "/assets/index-Abc.js", "/v1/x"]) {
      for (const host of [LEGACY, FLOW]) assert.equal((await get(path, { host })).headers.link, undefined, `${host}${path}`)
    }
  })
  for (const env of [{}, { LEGACY_UI_HOSTS: LEGACY, PUBLIC_URL: `https://${LEGACY}` }, { FLOW_UI_ORIGIN: FLOW_ORIGIN }, { ...OWN_HOST, PUBLIC_URL: FLOW_ORIGIN }, { ...OWN_HOST, FLOW_UI_ORIGIN: "flow.example.test" }]) {
    await withSite(env, async (get) => {
      for (const path of ["/", "/gallery", "/tutorials/x", "/login", "/app/x"]) {
        for (const host of [LEGACY, FLOW]) assert.equal((await get(path, { host })).headers.link, undefined, `${JSON.stringify(env)} ${host}${path}`)
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
