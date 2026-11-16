/**
 * Listening: the video's speech, transcribed once with word timings and the
 * speakers told apart (for switching cameras). Every step that reads the words
 * reads what this heard; it is never paid for twice on one video.
 */
import { transcribeApi } from "@/lib/api"
import { transcriptLanguage, wordsFromTranscript } from "../edit-plan"
import type { RunContext } from "./context"
import type { HeardVideo } from "./types"

/** The engine the video is listened to on: its id is also what the listening is priced at. */
export const LISTEN_PROVIDER = "elevenlabs-stt"
const TRANSCRIBE_MIN_TIMEOUT_MS = 10 * 60_000

export async function listen(ctx: RunContext, videoUrl: string): Promise<HeardVideo> {
  ctx.show.at("lead", { target: `media.item:${ctx.mediaId}` }, { gesture: { kind: "progress", value: 0.15 } })
  // diarize: the speakers' turns, which Switch cameras reads (the same price either way).
  const output = await ctx.jobs.run(() => transcribeApi(videoUrl, LISTEN_PROVIDER, undefined, ctx.userId, true, false, true), Math.max(TRANSCRIBE_MIN_TIMEOUT_MS, ctx.mediaSeconds * 250))
  const transcript = output.json
  return { words: wordsFromTranscript(transcript), language: transcriptLanguage(transcript), transcript }
}
