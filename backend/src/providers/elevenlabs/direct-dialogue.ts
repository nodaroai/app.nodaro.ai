import { config } from "../../lib/config.js"
import { requireProviderKey } from "../provider-keys.js"
import { providerFetch, type EgressMeta } from "../egress.js"
import { ELEVENLABS_BASE_URL } from "./client.js"
import { resolveDirectVoiceId } from "./direct-tts.js"
import { normalizeElevenLabsLanguageCode } from "./language-code.js"
import { normalizeTtsVoiceSetting } from "./voice-settings.js"
import { dialogueProviderOf, getDialogueCapabilities, dialogueSupportsTimestamps, type Transcript } from "@nodaro/shared"
import { dialogueWireModel, dialogueModelKey } from "./dialogue-models.js"
import { transcriptFromDialogueTimestamps } from "./alignment-transcript.js"

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

/** What a dialogue render hands back: the MP3 bytes and, on a model that returns timings, their transcript. */
export interface DialogueResult {
  audio: Buffer
  /** Per-word timings and one segment per line (speaker = the line's voice as sent). Absent when the model has no timings or the vendor's alignment was unusable. */
  transcript?: Transcript
}

/** The with-timestamps response (vendor shape; every field read defensively in alignment-transcript.ts). */
interface DialogueTimestampsResponse {
  audio_base64?: unknown
  alignment?: unknown
  voice_segments?: unknown
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
 * Synchronous call → bytes (+ transcript); no polling task, so no reconcile
 * wiring — the reconcile cron only picks up rows with a persisted
 * provider_call_started_at, which this path never sets (the worker pre-task
 * sentinel covers crashes).
 */
export async function directElevenLabsDialogue(
  inputs: DialogueInputLine[],
  options?: DirectDialogueOptions,
  meta?: EgressMeta,
): Promise<DialogueResult> {
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

  // The sheet decides the endpoint (decided 2026-10-06: always on when the
  // model has it). Same body either way; only the URL suffix and Accept move,
  // so a model without timings is byte-identical to before.
  const withTimestamps = dialogueSupportsTimestamps(provider)
  const url = `${ELEVENLABS_BASE_URL}/v1/text-to-dialogue${withTimestamps ? "/with-timestamps" : ""}`

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
      url,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: withTimestamps ? "application/json" : "audio/mpeg",
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
    if (response.status === 429) {
      // The vendor's concurrency / rate limit (v4 runs in its own concurrency
      // group, whose limit a dialogue holds for minutes). The user sees the
      // sentence the sound-effects funnel and the KIE client answer with —
      // `lib/mcp/tools/_job-error.ts` reads it as retryable, and the queue
      // re-sends the same request (no `deterministic` marker) — while the
      // operator keeps the raw status + body in `internalDetails`, the
      // duck-typed field `providerDetailOf` reads into `jobs.error_detail`.
      console.error(`[elevenlabs dialogue] 429: ${errorText.replace(/\s+/g, " ").slice(0, 500)}`)
      throw Object.assign(new Error("Service is temporarily busy. Please try again in a moment."), {
        internalDetails: `[text-to-dialogue 429] ${errorText}`.slice(0, 2000),
        status: 429,
      })
    }
    throw new Error(`ElevenLabs dialogue failed (${response.status}): ${errorText}`)
  }

  if (!withTimestamps) {
    return { audio: Buffer.from(await response.arrayBuffer()) }
  }

  // JSON branch: the audio must be there — a body without it delivered nothing,
  // so fail HERE, before any upload. The timings are best-effort: a shape the
  // builder cannot read leaves `transcript` absent and the audio still ships.
  const json = (await response.json().catch(() => undefined)) as DialogueTimestampsResponse | undefined
  if (!json || typeof json.audio_base64 !== "string" || json.audio_base64.length === 0) {
    throw new Error("ElevenLabs dialogue (with-timestamps) returned no audio")
  }
  const audio = Buffer.from(json.audio_base64, "base64")
  // A string that is not base64 decodes to zero bytes without throwing — that is no audio either.
  if (audio.length === 0) throw new Error("ElevenLabs dialogue (with-timestamps) returned no audio")
  const transcript = transcriptFromDialogueTimestamps(json.alignment, json.voice_segments, inputs, { language: languageCode })
  if (!transcript) {
    console.warn("[elevenlabs] dialogue with-timestamps: alignment unreadable; delivering audio without timings")
  }
  return transcript ? { audio, transcript } : { audio }
}
