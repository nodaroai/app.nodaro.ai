/**
 * `createSSEStream` over a REAL socket. `inject` never closes one, and a client
 * going away mid-stream is exactly what `isClosed` has to report: the plugin
 * toolkit's `tk.sse` promises it, and it is what stops the keepalive pings and
 * silences writes to a dead connection.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("../dynamic-origins.js", () => ({ isOriginAllowedDynamic: vi.fn().mockResolvedValue(false) }))

import { createSSEStream, type SSEController } from "../sse.js"

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

/** A POST route that opens a stream, writes one event, and leaves it open. */
async function serve(onOpen: (sse: SSEController) => void): Promise<string> {
  app = Fastify({ logger: false })
  app.post("/stream", async (req, reply) => {
    const sse = await createSSEStream(req, reply)
    onOpen(sse)
    sse.sendEvent({ type: "token", data: "first" })
  })
  await app.listen({ port: 0, host: "127.0.0.1" })
  const { port } = app.server.address() as AddressInfo
  return `http://127.0.0.1:${port}/stream`
}

function open(url: string, onResponse: (res: http.IncomingMessage, req: http.ClientRequest) => void): http.ClientRequest {
  const req = http.request(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => onResponse(res, req))
  req.on("error", () => {})
  req.end("{}")
  return req
}

describe("createSSEStream on a real connection", () => {
  it("reports a client that went away mid-stream", async () => {
    let sse: SSEController | undefined
    const url = await serve((s) => {
      sse = s
    })
    await new Promise<void>((resolve) => {
      open(url, (res, req) => {
        res.once("data", () => {
          req.destroy()
          resolve()
        })
      })
    })

    await vi.waitFor(() => expect(sse?.isClosed).toBe(true))
  })

  it("stays open while the client is connected, then closes on close()", async () => {
    let sse: SSEController | undefined
    let openAfterFirstEvent: boolean | undefined
    const url = await serve((s) => {
      sse = s
    })

    const body = await new Promise<string>((resolve) => {
      open(url, (res) => {
        let text = ""
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString()
          if (openAfterFirstEvent === undefined && text.includes("first")) {
            setTimeout(() => {
              openAfterFirstEvent = sse?.isClosed === false
              sse?.close()
            }, 50)
          }
        })
        res.on("end", () => resolve(text))
      })
    })

    expect(body).toContain('data: {"type":"token","data":"first"}')
    expect(openAfterFirstEvent).toBe(true)
    expect(sse?.isClosed).toBe(true)
  })
})
