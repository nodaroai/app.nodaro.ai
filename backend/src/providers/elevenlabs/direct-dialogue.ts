import { config } from "../../lib/config.js"
import { requireProviderKey } from "../provider-keys.js"
import { providerFetch, type EgressMeta } from "../egress.js"
import { ELEVENLABS_BASE_URL } from "./client.js"
import { resolveDirectVoiceId } from "./direct-tts.js"

/** One script line: what to say, and which voice says it. */
export interface DialogueInputLine {
  text: string
  voice: string
}

export interface DirectDialogueOptions {
  /** v3 stability — the API accepts exactly 0 / 0.5 / 1 for eleven_v3. */
  stability?: number
  languageCode?: string
  /** Deterministic sampling (0..4294967295), same semantics as v3 TTS. */
  seed?: number
  /** "auto" (default) | "on" | "off" — ElevenLabs text normalization. */
  applyTextNormalization?: "auto" | "on" | "off"
}

// Generous bound, explicit for the same reason as direct-tts's: a stalled
// connection must never idle a worker slot until undici's implicit ~300s.
// A 5,000-char dialogue was measured at 125s — 300s leaves real headroom.
const DIALOGUE_GENERATION_TIMEOUT_MS = 300_000

/**
 * Multi-speaker dialogue through the direct ElevenLabs API
 * (`POST /v1/text-to-dialogue`, model eleven_v3). Replaces the last KIE
 * ElevenLabs proxy (standing repo rule: always ElevenLabs direct) — which is
 * also what lifts the proxy's incidental premade-names-only voice limit:
 * per-line `resolveDirectVoiceId` means ANY voice works (premade name,
 * library UUID, clone UUID).
 *
 * Synchronous call → Buffer; no polling task, so no reconcile wiring — the
 * reconcile cron only picks up rows with a persisted provider_call_started_at,
 * which this path never sets (the worker pre-task sentinel covers crashes).
 */
export async function directElevenLabsDialogue(
  inputs: DialogueInputLine[],
  options?: DirectDialogueOptions,
  meta?: EgressMeta,
): Promise<Buffer> {
  const apiKey = config.ELEVENLABS_API_KEY
  if (!apiKey) {
    requireProviderKey(apiKey, "ELEVENLABS_API_KEY")
  }

  const body: Record<string, unknown> = {
    inputs: inputs.map((l) => ({ text: l.text, voice_id: resolveDirectVoiceId(l.voice) })),
    model_id: "eleven_v3",
  }
  if (options?.stability != null) body.settings = { stability: options.stability }
  if (options?.languageCode) body.language_code = options.languageCode
  if (options?.seed != null) body.seed = options.seed
  if (options?.applyTextNormalization) body.apply_text_normalization = options.applyTextNormalization

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DIALOGUE_GENERATION_TIMEOUT_MS)
  let response: Response
  try {
    response = await providerFetch(
      {
        provider: "elevenlabs",
        operation: "dialogue",
        // Single-purpose funnel → default OUR key inside (production callers
        // pass no meta); the key mirrors the route's reservation identifier.
        modelKey: meta?.modelKey ?? "elevenlabs-dialogue",
        body,
        dimensions: meta?.dimensions ?? {
          characters: inputs.reduce((sum, l) => sum + l.text.length, 0),
        },
      },
      `${ELEVENLABS_BASE_URL}/v1/text-to-dialogue`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`ElevenLabs dialogue timed out after ${DIALOGUE_GENERATION_TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs dialogue failed (${response.status}): ${errorText}`)
  }

  return Buffer.from(await response.arrayBuffer())
}
