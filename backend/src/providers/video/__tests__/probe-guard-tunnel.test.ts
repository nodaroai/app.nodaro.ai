// @test-reads-none sockets only: an origin and a client on the loopback, no file
/**
 * The probe guard's https tunnel delivers every byte the origin sent, even to a
 * reader slower than the origin. ffprobe reading an MP4 whose index sits at the
 * tail, or scanning every packet of a long WebM, is such a reader: an origin
 * that has sent all it has and closed must not cut off what is still on its way
 * to ffprobe. Plain sockets through the proxy (`openProbeEgress`), no ffprobe:
 * the tunnel is byte-agnostic, so TLS changes nothing here.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import net from "node:net"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { openProbeEgress, probeNetwork } from "../probe-guard.js"
import { proxyAuthorization } from "./probe-media-server.js"

const BODY_BYTES = 24 * 1024 * 1024

afterEach(() => vi.restoreAllMocks())

/** The proxy's port, from the `http_proxy` the run hands ffprobe (which also carries its credential). */
const proxyPort = (env: NodeJS.ProcessEnv) => Number(new URL(env.http_proxy!).port)

describe("the tunnel (CONNECT) through the probe guard", () => {
  it("a slow reader gets every byte of an origin that sent it all and closed", async () => {
    // The loopback stands in for a public host here.
    vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1" && isPrivateOrReservedIP(ip))
    const body = Buffer.alloc(BODY_BYTES, 7)
    const origin = net.createServer((s) => s.end(body))
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve))
    const egress = await openProbeEgress()
    try {
      const received = await new Promise<number>((resolve, reject) => {
        const client = net.connect(proxyPort(egress.env), "127.0.0.1")
        let head = ""
        let bytes = 0
        let tunnelled = false
        client.on("error", reject)
        client.write(`CONNECT cdn.test:${(origin.address() as net.AddressInfo).port} HTTP/1.1\r\nHost: cdn.test\r\nProxy-Authorization: ${proxyAuthorization(egress.env.http_proxy!)}\r\n\r\n`)
        client.on("data", (chunk: Buffer) => {
          if (!tunnelled) {
            head += chunk.toString("latin1")
            const end = head.indexOf("\r\n\r\n")
            if (end < 0) return
            tunnelled = true
            expect(head.startsWith("HTTP/1.1 200")).toBe(true)
            bytes += Buffer.byteLength(head.slice(end + 4), "latin1")
            // Read slower than the origin sends: by now it has written everything and closed.
            client.pause()
            setTimeout(() => client.resume(), 300)
            return
          }
          bytes += chunk.length
        })
        client.on("end", () => resolve(bytes))
      })
      expect(received).toBe(BODY_BYTES)
    } finally {
      await egress.close()
      await new Promise<void>((resolve) => origin.close(() => resolve()))
    }
  })
})
