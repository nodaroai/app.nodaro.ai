import { describe, it, expect } from "vitest"
import net from "node:net"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"
import { startProxyAuthShim } from "../proxy-auth-shim.js"

/**
 * A fake UPSTREAM proxy standing in for Decodo: it records the
 * `Proxy-Authorization` header of each CONNECT it receives, answers 200, and
 * echoes tunneled bytes back so we can assert the shim relays end-to-end.
 *
 * It tracks and destroys its hijacked CONNECT sockets on close() — server.close()
 * alone waits on them forever (closeAllConnections doesn't reach hijacked sockets).
 */
function fakeUpstreamProxy() {
  const connectAuth: (string | undefined)[] = []
  const sockets = new Set<Duplex>()
  const server = http.createServer()
  server.on("connect", (req, socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    connectAuth.push(req.headers["proxy-authorization"])
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    socket.on("data", (d) => socket.write(d)) // echo tunnel
    socket.on("error", () => socket.destroy())
  })
  const start = (): Promise<number> =>
    new Promise((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
    )
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const s of sockets) s.destroy()
      sockets.clear()
      server.close(() => resolve())
    })
  return { connectAuth, start, close }
}

/** Issue a CONNECT through `shimUrl` (treated as a proxy) to `target`; resolve the tunneled socket. */
function connectThroughShim(shimUrl: string, target: string): Promise<net.Socket> {
  const u = new URL(shimUrl)
  return new Promise((resolve, reject) => {
    // agent:false — the default agent pools sockets and mishandles CONNECT (hangs).
    const req = http.request({ host: u.hostname, port: Number(u.port), method: "CONNECT", path: target, agent: false })
    req.on("connect", (_res, socket) => resolve(socket))
    req.on("error", reject)
    req.end()
  })
}

describe("startProxyAuthShim", () => {
  it("injects the upstream Basic credentials on a CONNECT the client sent without any", async () => {
    const upstream = fakeUpstreamProxy()
    const upPort = await upstream.start()
    const shim = await startProxyAuthShim(`http://alice:s3cr3t@127.0.0.1:${upPort}`)
    try {
      const socket = await connectThroughShim(shim.url, "example.com:443")
      // Our client sent NO proxy auth, yet the upstream saw the injected credentials.
      expect(upstream.connectAuth).toEqual(["Basic " + Buffer.from("alice:s3cr3t").toString("base64")])
      // And the tunnel relays both ways (upstream echoes what we write).
      const echoed = await new Promise<Buffer>((resolve) => {
        socket.once("data", resolve)
        socket.write("ping")
      })
      expect(echoed.toString()).toBe("ping")
      socket.destroy()
    } finally {
      await shim.close()
      await upstream.close()
    }
  })

  it("url-decodes credentials before re-encoding them (creds with @ and : survive)", async () => {
    const upstream = fakeUpstreamProxy()
    const upPort = await upstream.start()
    const shim = await startProxyAuthShim(`http://user:p%40ss%3Aword@127.0.0.1:${upPort}`)
    try {
      const socket = await connectThroughShim(shim.url, "example.com:443")
      expect(upstream.connectAuth).toEqual(["Basic " + Buffer.from("user:p@ss:word").toString("base64")])
      socket.destroy()
    } finally {
      await shim.close()
      await upstream.close()
    }
  })

  it("omits Proxy-Authorization when the upstream URL carries no credentials", async () => {
    const upstream = fakeUpstreamProxy()
    const upPort = await upstream.start()
    const shim = await startProxyAuthShim(`http://127.0.0.1:${upPort}`)
    try {
      const socket = await connectThroughShim(shim.url, "example.com:443")
      expect(upstream.connectAuth).toEqual([undefined])
      socket.destroy()
    } finally {
      await shim.close()
      await upstream.close()
    }
  })

  it("binds to loopback only and stops accepting after close()", async () => {
    const upstream = fakeUpstreamProxy()
    const upPort = await upstream.start()
    const shim = await startProxyAuthShim(`http://u:p@127.0.0.1:${upPort}`)
    expect(shim.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await shim.close()
    await upstream.close()
    await expect(connectThroughShim(shim.url, "example.com:443")).rejects.toBeTruthy()
  })
})
