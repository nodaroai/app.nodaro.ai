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
 */
export async function handleMcpRequest(
  server: McpServer,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — each request is independent
  })

  reply.hijack()
  await server.connect(transport)
  await transport.handleRequest(request.raw, reply.raw, request.body)
}
