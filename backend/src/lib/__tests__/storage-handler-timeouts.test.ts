import { describe, it, expect, afterEach } from "vitest"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { NodeHttpHandler } from "@smithy/node-http-handler"

// Pins how the storage client's HTTP handler (@smithy/node-http-handler) bounds
// a request — the facts the R2 client timeouts (podcast Phase 2, Track 0.12)
// are designed on. Against a local server that stalls in the two ways a store
// can: never answering, and answering then never finishing the body.

let server: Server | undefined
afterEach(async () => {
  // The stalls hold their connections open on purpose: drop them, or close waits forever.
  server?.closeAllConnections()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

/** A server whose every request is handled by `onRequest`; returns its port. */
async function serve(onRequest: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  server = createServer(onRequest)
  // Sockets a stalled test leaves open must not keep the server from closing.
  server.on("connection", (socket) => socket.unref())
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  return (server!.address() as AddressInfo).port
}

function client(port: number, handler: ConstructorParameters<typeof NodeHttpHandler>[0]): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `http://127.0.0.1:${port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler(handler),
  })
}

/** Resolves "settled:<name>" or "error:<name>", or "pending" after `ms`. */
async function within(ms: number, work: Promise<unknown>): Promise<string> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<string>((resolve) => { timer = setTimeout(() => resolve("pending"), ms) })
  const outcome = work.then(
    () => "settled",
    (err: unknown) => `error:${(err as { name?: string })?.name ?? "Error"}`,
  )
  try {
    return await Promise.race([outcome, deadline])
  } finally {
    clearTimeout(timer)
  }
}

const drain = () => new Writable({ write: (_c, _e, cb) => cb() })

describe("@smithy/node-http-handler — what bounds a storage request", () => {
  it("requestTimeout + throwOnRequestTimeout bound a store that never answers", async () => {
    const port = await serve(() => { /* never respond */ })
    const s3 = client(port, { requestTimeout: 500, throwOnRequestTimeout: true })
    expect(await within(3_000, s3.send(new HeadObjectCommand({ Bucket: "b", Key: "k" })))).toBe("error:TimeoutError")
  })

  it("without throwOnRequestTimeout the same requestTimeout only WARNS — the request hangs", async () => {
    const port = await serve(() => { /* never respond */ })
    const s3 = client(port, { requestTimeout: 500, logger: { warn: () => {} } as never })
    expect(await within(2_000, s3.send(new HeadObjectCommand({ Bucket: "b", Key: "k" })))).toBe("pending")
  })

  it("a per-call requestTimeout reaches the handler (the lever for a size-scaled budget)", async () => {
    const port = await serve(() => { /* never respond */ })
    const s3 = client(port, { throwOnRequestTimeout: true })
    expect(await within(3_000, s3.send(new HeadObjectCommand({ Bucket: "b", Key: "k" }), { requestTimeout: 500 }))).toBe("error:TimeoutError")
  })

  // The timers are cleared the moment the response HEADERS arrive, so a body
  // that stops mid-stream is not bounded by requestTimeout at all.
  const stallBody = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Length": "1000", "Content-Type": "application/octet-stream" })
    res.write(Buffer.alloc(10))
    // ...and never the other 990 bytes.
  }

  it("requestTimeout does NOT bound a body that stalls after the headers", async () => {
    const port = await serve(stallBody)
    const s3 = client(port, { requestTimeout: 500, throwOnRequestTimeout: true })
    const res = await s3.send(new GetObjectCommand({ Bucket: "b", Key: "k" }))
    expect(await within(2_000, pipeline(res.Body as NodeJS.ReadableStream, drain()))).toBe("pending")
  })

  it("a socketTimeout under 6 s is set at once and does bound the stalled body", async () => {
    const port = await serve(stallBody)
    const s3 = client(port, { socketTimeout: 1_000 })
    const res = await s3.send(new GetObjectCommand({ Bucket: "b", Key: "k" }))
    expect(await within(4_000, pipeline(res.Body as NodeJS.ReadableStream, drain()))).toMatch(/^error:/)
  })

  it("a socketTimeout of 6 s or more is registered 3 s late — cleared by a fast response, so the stalled body hangs", async () => {
    const port = await serve(stallBody)
    const s3 = client(port, { socketTimeout: 6_000 })
    const res = await s3.send(new GetObjectCommand({ Bucket: "b", Key: "k" }))
    expect(await within(8_000, pipeline(res.Body as NodeJS.ReadableStream, drain()))).toBe("pending")
  }, 15_000)
})
