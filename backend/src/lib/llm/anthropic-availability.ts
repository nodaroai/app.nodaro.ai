/**
 * Can the platform's own Anthropic account serve a direct Claude call right now?
 *
 * One rule for every Claude path that can move to KIE — the film pipelines'
 * `callLLM`, the Copilot's agent loop, the route gates and the router's own
 * key tests — so none keeps its own notion: the key, TRIMMED, is non-empty
 * (a whitespace-only key is no key), and the direct-lane latch for
 * `anthropic` is closed (`llm-platform-exhaustion.ts`: armed by a refusal,
 * open for `DIRECT_LANE_LATCH_MS`). The latch is per process, so each API
 * replica and the pipeline worker pays one refused call per window.
 */
import { config } from "../config.js"
import { directLaneLatch } from "../llm-platform-exhaustion.js"

/** Which upstream serves a Claude call on the paths that can move. */
export type ClaudeLane = "direct" | "kie"

let keyMissingLogged = false

/** The Anthropic key, trimmed, is non-empty. */
export function anthropicKeySet(): boolean {
  return (config.ANTHROPIC_API_KEY ?? "").trim() !== ""
}

/** The KIE key, trimmed, is non-empty. */
export function kieKeySet(): boolean {
  return (config.KIE_API_KEY ?? "").trim() !== ""
}

/** The Gemini key, trimmed, is non-empty. */
export function geminiKeySet(): boolean {
  return (config.GEMINI_API_KEY ?? "").trim() !== ""
}

/**
 * Some local lane can serve an LLM call: the KIE, Anthropic or Gemini key,
 * each trimmed. The keyless-install test the cloud proxy reads (an install
 * holding none of the three sends its LLM calls to its Nodaro connection).
 */
export function localLlmKeySet(): boolean {
  return kieKeySet() || anthropicKeySet() || geminiKeySet()
}

/** The key is set AND the account is not latched out. */
export function anthropicDirectUsable(): boolean {
  return anthropicKeySet() && directLaneLatch("anthropic") === null
}

/**
 * The lane a pipeline stage attempt or a Copilot turn starts on: direct while
 * the account is usable, KIE otherwise — unless there is no KIE key to move
 * to, in which case the direct lane answers as it always did (a missing key
 * or a refusal then fails the way it does today). An empty key logs one line
 * per process.
 */
export function pickClaudeLane(): ClaudeLane {
  if (anthropicDirectUsable() || !kieKeySet()) return "direct"
  if (!anthropicKeySet() && !keyMissingLogged) {
    keyMissingLogged = true
    console.warn("Anthropic key not set — Claude calls go to KIE")
  }
  return "kie"
}

/** A route gate: some lane can serve a Claude call — the Anthropic account or KIE. */
export function claudeLaneConfigured(): boolean {
  return anthropicKeySet() || kieKeySet()
}

/** Test seam: forget that the missing-key line was logged. */
export function __resetAnthropicAvailabilityLog(): void {
  keyMissingLogged = false
}
