import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const available = spawnSync("caddy", ["version"]).status === 0
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

test("managed Supabase proxy preserves HTTP requests and WebSocket upgrades; bundled mode still works", { skip: !available }, async () => {
  const upstream = createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization, apikey: req.headers.apikey, host: req.headers.host }))
  })
  upstream.on("upgrade", (req, socket) => {
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const payload = Buffer.from(req.url)
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
    socket.on("data", () => socket.end(Buffer.from([0x88, 0])))
  })
  const up = await listen(upstream)
  const temp = mkdtempSync(join(tmpdir(), "managed-proxy-"))
  try {
    for (const managed of [true, false]) {
      const portProbe = createServer()
      const port = await listen(portProbe)
      await new Promise(resolve => portProbe.close(resolve))
      const config = join(temp, "Caddyfile")
      writeFileSync(config, readFileSync(new URL("../../frontend/Caddyfile", import.meta.url), "utf8").replace(":3000 {", `:${port} {`))
      const child = spawn("caddy", ["run", "--config", config, "--adapter", "caddyfile"], {
        env: { ...process.env, SUPABASE_MANAGED_PROXY: String(managed), SUPABASE_URL: `http://127.0.0.1:${up}`, SUPABASE_AUTH_UPSTREAM: `127.0.0.1:${up}`, SUPABASE_REST_UPSTREAM: `127.0.0.1:${up}` },
        stdio: ["ignore", "ignore", "pipe"],
      })
      let logs = ""
      child.stderr.on("data", data => { logs += data })
      const exited = new Promise(resolve => child.once("exit", resolve))
      try {
        for (let attempt = 0; attempt < 50; attempt++) {
          try { await fetch(`http://127.0.0.1:${port}/config.js`); break } catch {
            if (child.exitCode !== null) assert.fail(logs)
            await new Promise(resolve => setTimeout(resolve, 50))
          }
        }
        for (const path of ["/auth/v1/user", "/rest/v1/jobs?select=id"]) {
          const response = await fetch(`http://127.0.0.1:${port}/supabase${path}`, { headers: { authorization: "Bearer test-jwt", apikey: "test-anon" } })
          assert.equal(response.status, 200, logs)
          const echoed = await response.json()
          assert.equal(echoed.path, managed ? path : path.replace(/^\/(auth|rest)\/v1/, ""))
          assert.equal(echoed.authorization, "Bearer test-jwt")
          assert.equal(echoed.apikey, "test-anon")
          if (managed) assert.equal(echoed.host, `127.0.0.1:${up}`)
        }
        if (managed) {
          const path = "/realtime/v1/websocket?vsn=1.0.0"
          const socket = new WebSocket(`ws://127.0.0.1:${port}/supabase${path}`)
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { socket.close(); reject(new Error("WebSocket upgrade timed out")) }, 5000)
            socket.addEventListener("message", event => { clearTimeout(timeout); try { assert.equal(event.data, path); resolve() } catch (error) { reject(error) } finally { socket.close() } }, { once: true })
            socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WebSocket upgrade failed")) }, { once: true })
          })
        }
      } finally {
        child.kill("SIGTERM")
        await exited
      }
    }
  } finally {
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
    rmSync(temp, { recursive: true })
  }
})
