import type { FastifyRequest, FastifyReply } from "fastify"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

/**
 * Bridges Fastify's request/reply pair to the SDK's StreamableHTTPServerTransport.
 *
 * The SDK transport reads JSON-RPC requests from Node's IncomingMessage and writes
 * responses (or SSE streams for long-lived connections) to ServerResponse. We wire
 * Fastify's `.raw` references through and let Fastify get out of the way — the SDK
 * fully owns the response lifecycle once we hand off.
 *
 * Fastify-side: we DO NOT call `reply.send()`; the transport flushes the response.
 * Calling reply.hijack() tells Fastify the handler is done managing the response.
 *
 * Error handling: any throw from `server.connect()` or `transport.handleRequest()`
 * is logged and (if the response is still clean) returned as an MCP-spec error
 * payload. Without this, an uncaught exception would leave the response stream
 * half-written and the host would show "Tool result could not be submitted —
 * the request may have expired or the connection was interrupted."
 */
export async function handleMcpRequest(
  server: McpServer,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — each request is independent
    // Force plain JSON responses (no SSE streaming). With SSE, the transport
    // keeps the response stream open for ~1s per request waiting for
    // additional progress events that never come (we don't use async
    // notifications), which adds 1100ms latency to EVERY tool call. Cursor
    // in particular is sensitive — it sees the slow responses and gets stuck
    // in a resources/subscribe loop, never advancing to tools/call. JSON
    // responses close the connection immediately; Claude.ai handles them
    // identically.
    enableJsonResponse: true,
  })

  reply.hijack()

  // Log the JSON-RPC method + tool name (if any) before handing off to the
  // transport. Lets us trace per-client behaviour in Railway when something
  // breaks (e.g. Cursor cancelling generate_image without a clear cause).
  try {
    const body = request.body as Record<string, unknown> | undefined
    const method = typeof body?.method === "string" ? body.method : undefined
    const params = body?.params as Record<string, unknown> | undefined
    const toolName = method === "tools/call" ? (params?.name as string | undefined) : undefined
    const ua = request.headers["user-agent"]
    request.log.info(
      { method, toolName, ua, mcpSession: request.headers["mcp-session-id"] },
      "[mcp] incoming",
    )
  } catch {
    // Logging is best-effort.
  }

  try {
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  } catch (err) {
    request.log.error({ err }, "MCP request handler failed")
    // If the SDK already started writing the response, we can't write a clean
    // error — just end the stream so the client doesn't hang.
    if (reply.raw.headersSent || reply.raw.writableEnded) {
      try {
        reply.raw.end()
      } catch {
        // already closed
      }
      return
    }
    // Send an MCP-spec internal_error so the host shows a clear failure
    // instead of "request expired."
    try {
      reply.raw.writeHead(500, { "Content-Type": "application/json" })
      reply.raw.end(
        JSON.stringify({
          jsonrpc: "2.0",
          // id may be unknown at this point — null is the spec fallback for
          // malformed/unparseable requests.
          id: null,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Internal MCP error",
          },
        }),
      )
    } catch {
      // raw.write/end can throw if the socket was already destroyed.
    }
  }
}
