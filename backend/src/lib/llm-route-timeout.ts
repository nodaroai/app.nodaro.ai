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
 */
export const LLM_ROUTE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
