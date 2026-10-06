import { config } from "../../lib/config.js"
import { requireProviderKey } from "../provider-keys.js"
import { providerFetch, type EgressMeta } from "../egress.js"
import { ELEVENLABS_BASE_URL } from "./client.js"
import { resolveDirectVoiceId } from "./direct-tts.js"
import { normalizeElevenLabsLanguageCode } from "./language-code.js"
import { normalizeTtsVoiceSetting } from "./voice-settings.js"
import { dialogueProviderOf, getDialogueCapabilities } from "@nodaro/shared"
import { dialogueWireModel, dialogueModelKey } from "./dialogue-models.js"

/** One script line: what to say, and which voice says it. */
export interface DialogueInputLine {
  text: string
  voice: string
}

export interface DirectDialogueOptions {
  /** Our dialogue model id (`DIALOGUE_PROVIDERS`). Missing, unknown or not a string → v3 dialogue. */
  provider?: string
  /**
   * 0–1. Sent as given: the steps v3 dialogue is limited to are the ROUTE's
   * contract (dialogue-capabilities.ts), and the orchestrator path, which skips
   * the route, has always forwarded the node's value.
   */
  stability?: number
  /** 0–1. Sent (as `settings.similarity`) only to a model whose sheet lists the `similarity` lever. */
  similarityBoost?: number
  languageCode?: string
  /** Deterministic sampling (0..4294967295). */
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
 * (`POST /v1/text-to-dialogue`). The model, the settings it is sent and whether
 * it takes a language code come from the dialogue model's capability sheet —
 * never from a comparison with an id. Per-line `resolveDirectVoiceId` means ANY
 * voice works (premade name, library UUID, clone UUID).
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

  const provider = dialogueProviderOf(options?.provider)
  const sheet = getDialogueCapabilities(provider)
  const body: Record<string, unknown> = {
    inputs: inputs.map((l) => ({ text: l.text, voice_id: resolveDirectVoiceId(l.voice) })),
    model_id: dialogueWireModel(provider),
  }
  // Values arrive from every lane exactly as their enqueuer wrote them (only the
  // route validates): a numeric string becomes its number, out of range is
  // clamped, anything else is absent — see voice-settings.ts.
  const stability = sheet.levers.includes("stability") ? normalizeTtsVoiceSetting("stability", options?.stability) : undefined
  const similarity = sheet.levers.includes("similarity") ? normalizeTtsVoiceSetting("similarityBoost", options?.similarityBoost) : undefined
  if (stability !== undefined || similarity !== undefined) {
    const settings: Record<string, number> = {}
    if (stability !== undefined) settings.stability = stability
    if (similarity !== undefined) settings.similarity = similarity
    body.settings = settings
  }
  const languageCode = sheet.languageCode ? normalizeElevenLabsLanguageCode(options?.languageCode) : undefined
  if (languageCode) body.language_code = languageCode
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
        // OUR key: the id the request runs as, which IS the route's reservation identifier.
        modelKey: meta?.modelKey ?? dialogueModelKey(provider),
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
