/**
 * One transcription per podcast pack (decided 2026-11-18). Every tool of a
 * pack starts with the same transcription of the same recording; the tools
 * of one pack start together, so without this the provider is paid once per
 * tool for identical work. A covered transcribe step (lib/covered-step.ts)
 * therefore asks the provider only once per pack and settings:
 *
 * - the first step to arrive takes a Redis lease on the pack's key and
 *   transcribes, renewing the lease while it works, then keeps the result
 *   (compressed, for {@link RESULT_TTL_MS}) and lets the lease go;
 * - the others wait for that result and take it as their own output — their
 *   own job still completes and settles (at 0: the pack paid);
 * - a holder that fails or dies lets the lease lapse, and the next step
 *   transcribes itself; a step that waited past {@link MAX_WAIT_MS}
 *   transcribes itself too, and a cancelled one stops waiting at once.
 *
 * Sharing never fails a step: any Redis error, or a result that cannot be
 * read, falls back to the step's own transcription. Every step that is not
 * covered transcribes as it always did.
 */
import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import { supabase } from "./supabase.js"
import { redis } from "./queue.js"
import { acquireLease, releaseLease, renewLease } from "./redis-lease.js"
import { coveredMarkOf } from "./covered-step.js"

/** How long a pack's transcription is kept for its other tools (they start together). */
export const RESULT_TTL_MS = 30 * 60_000
/** The lease a transcribing step holds, renewed every {@link RENEW_EVERY_MS} while it works. */
export const LEASE_TTL_MS = 2 * 60_000
const RENEW_EVERY_MS = 30_000
/** How often a waiting step looks again. */
export const POLL_MS = 3_000
/** The longest a step waits for another's transcription before it transcribes itself (its own then still fits its node's 90 minutes). */
export const MAX_WAIT_MS = 45 * 60_000

/** What a transcription is asked: the same answer for the same audio and settings. */
export interface TranscriptRequest {
  readonly audioUrl: string
  readonly provider?: string
  readonly language?: string
  readonly diarize?: boolean
  readonly tagAudioEvents?: boolean
  readonly wordTimestamps?: boolean
  readonly targetLanguage?: string
}

/** The pack's share key for a request, under its pack. */
export function transcriptShareKey(packId: string, req: TranscriptRequest): string {
  const material = JSON.stringify([
    req.audioUrl, req.provider ?? null, req.language ?? null, req.diarize ?? null,
    req.tagAudioEvents ?? null, req.wordTimestamps ?? null, req.targetLanguage ?? null,
  ])
  return `pack-transcript:${packId}:${createHash("sha256").update(material).digest("hex").slice(0, 32)}`
}

/** The pack a step's hold names, or null (not covered, or unreadable: the step transcribes itself). */
export async function packOfStep(usageLogId: string | null | undefined): Promise<string | null> {
  if (!usageLogId) return null
  try {
    const { data, error } = await supabase.from("usage_logs").select("metadata").eq("id", usageLogId).maybeSingle()
    if (error) return null
    return coveredMarkOf((data as { metadata?: unknown } | null)?.metadata)?.by ?? null
  } catch {
    return null
  }
}

const resultKey = (key: string) => `${key}:result`

async function readResult(key: string): Promise<Record<string, unknown> | null> {
  const stored = await redis.getBuffer(resultKey(key))
  if (!stored) return null
  const parsed = JSON.parse(gunzipSync(stored).toString("utf8")) as unknown
  return parsed && typeof parsed === "object" && typeof (parsed as { text?: unknown }).text === "string" ? (parsed as Record<string, unknown>) : null
}

async function keepResult(key: string, output: Record<string, unknown>): Promise<void> {
  await redis.set(resultKey(key), gzipSync(Buffer.from(JSON.stringify(output), "utf8")), "PX", RESULT_TTL_MS)
}

export type SharedTranscript<T> = { readonly reused: false; readonly produced: T } | { readonly reused: true; readonly output: Record<string, unknown> }

export interface ShareDeps {
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  /** Throws when the waiting step's job was cancelled: a cancelled step stops waiting at once. */
  readonly stopIfCancelled: () => Promise<void>
}
const realDeps: ShareDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  stopIfCancelled: async () => (await import("./job-cancellation.js")).throwIfJobCancelled(),
}

/**
 * The step's transcription: another step's of the same pack when one has it
 * (or is making it), else its own (`produce`, whose output — `outputOf` —
 * is then kept for the pack's other steps).
 */
export async function sharedTranscript<T>(
  key: string,
  produce: () => Promise<T>,
  outputOf: (produced: T) => Record<string, unknown>,
  deps: ShareDeps = realDeps,
): Promise<SharedTranscript<T>> {
  const own = async (): Promise<SharedTranscript<T>> => ({ reused: false, produced: await produce() })
  const started = deps.now()
  for (;;) {
    let token: string | null
    try {
      const kept = await readResult(key)
      if (kept) return { reused: true, output: kept }
      token = await acquireLease(key, LEASE_TTL_MS)
    } catch (err) {
      console.warn(`[pack-transcript] ${key}: sharing unavailable, transcribing alone:`, (err as Error).message)
      return own()
    }
    if (token) return produceAndKeep(key, token, produce, outputOf)
    await deps.stopIfCancelled()
    if (deps.now() - started >= MAX_WAIT_MS) {
      console.warn(`[pack-transcript] ${key}: waited ${MAX_WAIT_MS} ms for another step's transcription, transcribing alone`)
      return own()
    }
    await deps.sleep(POLL_MS)
  }
}

async function produceAndKeep<T>(key: string, token: string, produce: () => Promise<T>, outputOf: (produced: T) => Record<string, unknown>): Promise<SharedTranscript<T>> {
  const renew = setInterval(() => {
    void renewLease(key, token, LEASE_TTL_MS).catch(() => undefined)
  }, RENEW_EVERY_MS)
  try {
    const produced = await produce()
    try {
      await keepResult(key, outputOf(produced))
    } catch (err) {
      console.warn(`[pack-transcript] ${key}: the transcription could not be kept for the pack's other steps:`, (err as Error).message)
    }
    return { reused: false, produced }
  } finally {
    clearInterval(renew)
    await releaseLease(key, token).catch(() => undefined)
  }
}
