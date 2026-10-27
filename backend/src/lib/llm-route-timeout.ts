/**
 * How long the synchronous LLM routes (`/v1/llm-chat/generate`, the stream,
 * `/v1/ai-writer/*`) may take before Fastify closes the connection.
 *
 * It was 120 s. A long answer — a 16k-token classification of a morning's
 * posts — takes longer than that, and the server then closed the socket
 * mid-call: the orchestrator's internal fetch failed with
 * "UND_ERR_SOCKET: other side closed", the node and the run were marked
 * failed, while the model call itself ran on and was billed (2026-10-07,
 * twice, on staging and production). The node's own ceiling is
 * `NODE_TIMEOUT_MS` (90 min); the LLM client bounds the provider call. This
 * only has to be longer than the longest honest answer.
 *
 * It is applied through `req.raw.setTimeout(...)` / `reply.raw.setTimeout(...)`
 * in the handlers — the SOCKET idle timeout, which is what actually destroys
 * the connection when no byte moves for that long. The route-level
 * `config.requestTimeout` is read by nothing; raising only the constant it
 * carried left the hand-typed 120 s socket timeouts in place, and the runs
 * kept dying at 121 s (2026-10-08, three scheduled runs on production).
 */
export const LLM_ROUTE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

/** A Fastify request or reply: its `raw` is the Node message, whose `socket` carries the idle timeout. */
interface WithRaw {
  raw: unknown
}

/**
 * Sets the socket idle timeout of a request to `ms` — on the connection's
 * socket itself, which is what `req.raw.setTimeout` / `reply.raw.setTimeout`
 * do underneath (request and reply share the one socket). A request a plugin
 * worker sends from inside the server (`app.inject`, through the toolkit's
 * worker request) has no real socket, so it is left as it is. Calling the
 * message's own `setTimeout` there failed twice (2026-10-27, the cast-swap
 * scene description on staging): first "req.raw.setTimeout is not a
 * function", then light-my-request's reply, whose `setTimeout` requires a
 * callback ("The listener argument must be of type function").
 */
export function extendSocketTimeout(req: WithRaw, reply: WithRaw, ms: number): void {
  for (const message of [req.raw, reply.raw]) {
    const socket = (message as { socket?: unknown } | null | undefined)?.socket
    const setTimeout = (socket as { setTimeout?: unknown } | null | undefined)?.setTimeout
    if (typeof setTimeout === "function") {
      setTimeout.call(socket, ms)
      return
    }
  }
}
