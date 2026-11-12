import type { FastifyReply } from "fastify"

/**
 * A signal that aborts when the client goes away before the response is sent:
 * the response's `close` before it finished. Never the request's `close`,
 * which fires once the body has been read. A route that fetches or copies
 * an input before it answers passes it on, so a client that disconnects stops
 * the fetch and frees its download slot. Such a route answers with
 * {@link CLIENT_CLOSED} (499).
 */
export function clientGoneSignal(reply: FastifyReply): AbortSignal {
  const gone = new AbortController()
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) gone.abort()
  })
  return gone.signal
}

/**
 * The answer to a request whose client went away mid-fetch (499, nothing held).
 * A client's own disconnect is not a server error to report.
 */
export const CLIENT_CLOSED = { code: "client_closed", message: "The client closed the request." } as const
