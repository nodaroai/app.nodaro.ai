import {
  SEEDANCE_2_REF_LIMITS,
  VIDEO_REF_AUDIO_RULES,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  checkRefAudioRules,
  type RefAudioCheck,
  type RefAudioProbe,
} from "@nodaro/shared/models"
import { probeMediaFormatAndDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Reference-audio contract check — CORE, the audio twin of `ref-video-probe.ts`.
 *
 * A provider's documented per-clip rule (`VIDEO_REF_AUDIO_RULES`: accepted
 * formats, minimum and maximum length) is checked on EVERY lane that can start
 * a reference-audio run, before anything is reserved:
 *   - the video routes' `validateSeedance2AudioPreHandler` → a 400 before
 *     creditGuard;
 *   - the DAG's `executeWorkerNode` → a coded throw before the jobs row's
 *     reservation and the queue dispatch.
 *
 * Input validation, not a credit feature: it runs in every edition, so it lives
 * here and never reaches into `ee/`.
 *
 * Data-driven: a provider without a rule is never probed, so this adds no work
 * to any other lane. Nothing CONVERTS a clip — a WAV / M4A / OGG from the audio
 * tray is refused with a message that says what the model takes.
 */

/** Container a URL's file extension names, in ffprobe's `format_name` spelling —
 *  the fallback when the probe itself could not run. Unknown → undefined. */
const EXTENSION_FORMAT: Readonly<Record<string, string>> = {
  mp3: "mp3", wav: "wav", m4a: "mp4", mp4: "mp4", aac: "aac", ogg: "ogg", opus: "ogg", flac: "flac", webm: "webm",
}

function formatFromUrl(url: string): string | undefined {
  const ext = url.split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  return ext ? EXTENSION_FORMAT[ext] : undefined
}

/**
 * Probe and check the connected reference audio against the provider's rule.
 *
 * Never throws. A clip ffprobe cannot read falls back to its URL extension for
 * the format and to "unknown" for the length, and an unknown field is IGNORED
 * by `checkRefAudioRules` — a probe blip can never manufacture a rejection; the
 * provider still has the final say. At most the provider's audio cap is probed.
 */
export async function probeAndCheckRefAudio(args: {
  provider: string | undefined
  referenceAudioUrls: unknown
}): Promise<RefAudioCheck> {
  const provider = args.provider ?? ""
  const urls = args.referenceAudioUrls
  if (!Array.isArray(urls) || urls.length === 0) return { ok: true }
  if (!VIDEO_REF_AUDIO_RULES[provider]) return { ok: true }

  const cap = { ...SEEDANCE_2_REF_LIMITS, ...(VIDEO_REF_LIMITS_BY_PROVIDER[provider] ?? {}) }.audio
  const candidates = urls
    .slice(0, cap)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
  const settled = await Promise.allSettled(candidates.map((u) => probeMediaFormatAndDuration(u)))
  const probes: RefAudioProbe[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value
    const fromUrl = formatFromUrl(candidates[i]!)
    return fromUrl ? { formatNames: [fromUrl] } : {}
  })
  return checkRefAudioRules(provider, probes)
}
