import { TTS_OUTPUT_FORMATS, type TtsOutputFormat } from "@nodaro/shared/models"

/**
 * A Text to Speech node's file (decided 2026-11-13), when it is one the
 * platform offers (`TTS_OUTPUT_FORMATS`: every speech model delivers each);
 * undefined for none or a stale value — the default MP3, as the route and the
 * server's run read it.
 */
export function ttsOutputFormatOf(value: unknown): TtsOutputFormat | undefined {
  return typeof value === "string" && (TTS_OUTPUT_FORMATS as readonly string[]).includes(value) ? (value as TtsOutputFormat) : undefined
}
