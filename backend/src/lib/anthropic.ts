import Anthropic from "@anthropic-ai/sdk"
import { config } from "./config.js"

export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929"

/**
 * Client-level request deadline. Its real job is to switch OFF the SDK's
 * non-streaming guard.
 *
 * `messages.create` refuses outright — before any network call — when the
 * request is non-streaming, the client carries NO timeout of its own, and
 * `max_tokens` implies over 10 minutes of generation:
 *
 *     expectedTime = 60min * max_tokens / 128_000 > 10min   ⟺   max_tokens > 21_333
 *     → AnthropicError("Streaming is required for operations that may take
 *        longer than 10 minutes")
 *
 * That trips on real traffic. `deriveParams` (llm-client.ts) and the film
 * pipeline's `callLLM` both floor `max_tokens` at 32_768 whenever reasoning
 * shares the output budget — which for a `thinkingDefaultOn` model means EVERY
 * call, so before this every non-streamed direct-Anthropic Claude Opus 5 call
 * threw here 100% of the time, as did any Claude call at xhigh/max effort.
 * Combined with KIE's Claude proxy 500ing on all non-stream requests
 * (KIE_CLAUDE_NONSTREAM_VERIFIED), Opus 5 had no working lane at all.
 *
 * The guard is a heuristic for callers who never declared a deadline; we
 * always do (`LlmRequest.timeoutMs`, per-request, which overrides this).
 * 600_000 is exactly the value the SDK would have used for a request that
 * PASSED the guard, so every previously-working call keeps its old deadline
 * and only the upfront throw goes away.
 */
const ANTHROPIC_CLIENT_TIMEOUT_MS = 600_000

let _client: Anthropic | null = null
export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: (config.ANTHROPIC_API_KEY ?? "").trim(),
      timeout: ANTHROPIC_CLIENT_TIMEOUT_MS,
    })
  }
  return _client
}
