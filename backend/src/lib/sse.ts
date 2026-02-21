import type { FastifyRequest, FastifyReply } from "fastify"
import { config } from "./config.js"

// Build allowed origins set (mirrors CORS config in app.ts)
const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://app.scenenode.ai",
])
if (config.CORS_ORIGIN) {
  for (const o of config.CORS_ORIGIN.split(",")) {
    const trimmed = o.trim()
    if (trimmed) allowedOrigins.add(trimmed)
  }
}

// ---------------------------------------------------------------------------
// SSE Event Protocol
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "token"; data: string }
  | { type: "metadata"; data: Record<string, unknown> }
  | { type: "progress"; step: number; total: number; message: string }
  | { type: "done"; data: Record<string, unknown> }
  | { type: "error"; data: { code: string; message: string } }

// ---------------------------------------------------------------------------
// SSE Controller
// ---------------------------------------------------------------------------

export interface SSEController {
  /** Send a structured event to the client. */
  sendEvent(event: StreamEvent): void
  /** Send an SSE comment (used for keepalive pings). */
  sendComment(text?: string): void
  /** End the stream and clean up resources. */
  close(): void
  /** True after close() is called or the client disconnects. */
  readonly isClosed: boolean
}

const KEEPALIVE_INTERVAL_MS = 15_000

/**
 * Create an SSE stream on a Fastify request/reply pair.
 *
 * Usage:
 * ```ts
 * app.get("/v1/my-stream", async (req, reply) => {
 *   const sse = createSSEStream(req, reply)
 *   sse.sendEvent({ type: "token", data: "hello" })
 *   sse.close()
 * })
 * ```
 */
export function createSSEStream(
  req: FastifyRequest,
  reply: FastifyReply,
): SSEController {
  // -- Headers ---------------------------------------------------------------
  // Because we write to reply.raw directly, Fastify's onSend hooks (where
  // @fastify/cors injects headers) are bypassed. Only reflect origins that
  // are in the allowed set (H8 fix: prevents arbitrary origin reflection).
  const corsHeaders: Record<string, string> = {}
  const origin = req.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    corsHeaders["Access-Control-Allow-Origin"] = origin
    corsHeaders["Access-Control-Allow-Credentials"] = "true"
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...corsHeaders,
  })

  let closed = false

  // -- Helpers ---------------------------------------------------------------

  function write(chunk: string): void {
    if (closed) return
    reply.raw.write(chunk)
  }

  function sendEvent(event: StreamEvent): void {
    write(`data: ${JSON.stringify(event)}\n\n`)
  }

  function sendComment(text = "keepalive"): void {
    write(`: ${text}\n\n`)
  }

  function cleanup(): void {
    if (closed) return
    closed = true
    clearInterval(keepaliveTimer)
  }

  function close(): void {
    cleanup()
    if (!reply.raw.writableEnded) {
      reply.raw.end()
    }
  }

  // -- Keepalive -------------------------------------------------------------

  const keepaliveTimer = setInterval(() => {
    sendComment()
  }, KEEPALIVE_INTERVAL_MS)

  // -- Client disconnect -----------------------------------------------------

  req.raw.on("close", cleanup)

  // --------------------------------------------------------------------------

  return {
    sendEvent,
    sendComment,
    close,
    get isClosed() {
      return closed
    },
  }
}
