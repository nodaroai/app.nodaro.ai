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

/** Anything whose `raw` may carry a socket idle timeout (a Fastify request or reply). */
interface WithRaw {
  raw: unknown
}

/**
 * Sets the socket idle timeout of a request and its reply to `ms`, when there
 * is a socket to set. A request a plugin worker sends from inside the server
 * (`app.inject`, through the toolkit's worker request) has no socket: its
 * `raw` objects carry no `setTimeout`, and calling it threw "req.raw.setTimeout
 * is not a function", a 500 for every such call (the cast-swap scene
 * description on staging, 2026-10-27). Such a request has no idle timeout to
 * raise, so it is left as it is.
 */
export function extendSocketTimeout(req: WithRaw, reply: WithRaw, ms: number): void {
  for (const target of [req.raw, reply.raw]) {
    const setTimeout = (target as { setTimeout?: unknown } | null)?.setTimeout
    if (typeof setTimeout === "function") setTimeout.call(target, ms)
  }
}

