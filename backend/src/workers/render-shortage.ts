/**
 * A render that ran into the container's process limit.
 *
 * WHAT HAPPENED (2026-11-25, read from the production log). Two renders at
 * once used every thread the container may have. One render's encoder could
 * not open — the renderer reports that only as an unhandled rejection ("FFmpeg
 * quit with code 187") and keeps drawing frames nobody encodes; the other's
 * frame server could not start a thread, so one frame never arrived and every
 * later frame waited behind it. Neither render failed: each sat on its threads
 * for two to three minutes until a 120-second wait inside the renderer gave
 * up (25 minutes on 2026-11-23, when it never did), failed with a message
 * naming an internal address, and was run again five seconds later into the
 * same shortage, four times. Five jobs kept the container full for 24 minutes;
 * every render attempt in that time failed, other jobs could not start ffmpeg,
 * and the proxy died. A render that ran alone finished in 26 seconds.
 *
 * WHAT THIS DOES. The kernel counts each process or thread it refuses
 * (`lib/process-shortage.ts`), so:
 *  - a refusal makes every running render a suspect for
 *    {@link SHORTAGE_SUSPECT_MS}; a suspect that makes no progress for
 *    {@link SHORTAGE_STALL_MS} is stopped at once instead of holding its
 *    threads until a timeout (`RenderTrack.stuck`);
 *  - the renderer's own "encoder quit" rejection makes renders suspects the
 *    same way, so a render without an encoder is stopped as fast — but it is
 *    a shortage only when the kernel also refused something. An encoder that
 *    quits on an idle box fails as what it is ({@link RenderEncoderError}),
 *    never as "the server is busy": that would be retried for minutes and
 *    tell the user to try again at something that cannot work;
 *  - a render that failed while the container was refusing is run again after
 *    a real wait ({@link shortageRetryDelayMs}), not five seconds later, and
 *    counts against the same number of runs a job always had;
 *  - for {@link SHORTAGE_SERIAL_MS} after a refusal, renders run one at a
 *    time: one render fits where two did not, so the queue keeps moving;
 *  - a job that still fails says {@link RENDER_SHORTAGE_MESSAGE}, never the
 *    renderer's raw timeout.
 *
 * With no refusal nothing here does anything: a slow render is never touched.
 *
 * Pure decisions with injectable clock and signals; `renderWatch()` is the
 * process's one instance.
 */
import { processShortageObserver } from "../lib/process-shortage.js"

/** What a user sees when a job's last run failed for the box's shortage. */
export const RENDER_SHORTAGE_MESSAGE = "The render server is busy right now and could not finish this video — try again in a few minutes."

/** After a refusal, every running render is a suspect for this long. */
export const SHORTAGE_SUSPECT_MS = 120_000
/** A suspect that makes no progress for this long is stopped. */
export const SHORTAGE_STALL_MS = 25_000
/** After a refusal, renders run one at a time for this long. */
export const SHORTAGE_SERIAL_MS = 10 * 60_000
/** How long a render that must wait its turn is put back for (plus up to {@link SHORTAGE_TURN_JITTER_MS}). */
export const SHORTAGE_TURN_RECHECK_MS = 15_000
export const SHORTAGE_TURN_JITTER_MS = 5_000
/** The wait before a render that failed in a shortage runs again: this, doubled per earlier retry, up to the cap, plus jitter. */
export const SHORTAGE_RETRY_BASE_MS = 60_000
export const SHORTAGE_RETRY_MAX_MS = 5 * 60_000
export const SHORTAGE_RETRY_JITTER_MS = 30_000

/** A render stopped, or failed, because the container had no process or thread left. */
export class RenderShortageError extends Error {
  readonly renderShortage = true as const
  constructor(readonly detail: string) {
    super(RENDER_SHORTAGE_MESSAGE)
    this.name = "RenderShortageError"
  }
}

/** What a user sees when a render's encoder quit and nothing says the box was short of anything. */
export const RENDER_ENCODER_MESSAGE = "The video encoder stopped before this render finished."

/** A render stopped because its encoder quit under it, with no refusal from the kernel to explain it. */
export class RenderEncoderError extends Error {
  constructor(readonly detail: string) {
    super(RENDER_ENCODER_MESSAGE)
    this.name = "RenderEncoderError"
  }
}

/** The renderer's own report that a render's encoder is gone: what it rejects with (unhandled) when ffmpeg quits under it. */
export function isRendererEncoderDeath(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false
  const { message, code } = reason as { message?: unknown; code?: unknown }
  return code === "EPIPE" || (typeof message === "string" && /^FFmpeg (already )?quit\b/.test(message))
}

export function shortageRetryDelayMs(earlierRetries: number, random: () => number = Math.random): number {
  const base = Math.min(SHORTAGE_RETRY_MAX_MS, SHORTAGE_RETRY_BASE_MS * 2 ** Math.max(0, Math.floor(earlierRetries)))
  return base + Math.floor(random() * SHORTAGE_RETRY_JITTER_MS)
}

export function shortageTurnDelayMs(random: () => number = Math.random): number {
  return SHORTAGE_TURN_RECHECK_MS + Math.floor(random() * SHORTAGE_TURN_JITTER_MS)
}

/** How many times a job was already put back after a shortage (kept in its queue data). */
export function shortageRetriesOf(data: unknown): number {
  const kept = (data as { shortageRetries?: unknown } | null | undefined)?.shortageRetries
  return typeof kept === "number" && Number.isInteger(kept) && kept > 0 ? kept : 0
}

/**
 * Whether this run is the job's last. A run put back after a shortage does not
 * count as a failed attempt in the queue, so it is counted here: failed
 * attempts and shortage retries together never exceed the attempts the job was
 * queued with — a shortage changes how long the next run waits, never how many
 * runs a job gets.
 */
export function isLastRenderRun(job: { readonly attemptsMade: number; readonly opts?: { readonly attempts?: number }; readonly data: unknown }): boolean {
  return job.attemptsMade + shortageRetriesOf(job.data) + 1 >= (job.opts?.attempts ?? 1)
}

export interface RenderWatchDeps {
  readonly now: () => number
  /** When the container last refused a process or thread, as of now; undefined when it never did. */
  readonly lastRefusalAt: () => number | undefined
}

/** One render, from the moment its browser is asked for until it ends. */
export interface RenderTrack {
  /** The renderer's start report: how many frames, and whether they are encoded while they are drawn. */
  started(info: { readonly frameCount: number; readonly parallelEncoding: boolean }): void
  progress(frames: { readonly renderedFrames: number; readonly encodedFrames: number }): void
  /** The error to stop this render with — it is a suspect and has made no progress — or undefined:
   *  a shortage when the kernel refused something, the encoder's own failure when only the renderer reported one. */
  stuck(): RenderShortageError | RenderEncoderError | undefined
  /** Whether the container refused a process or thread while this render ran, or shortly before it began. */
  sawShortage(): boolean
}

export interface RenderWatch {
  track(): RenderTrack
  /** The renderer reported an encoder gone (its rejection, as given): renders are suspects as after a refusal. */
  noteEncoderDeath(report?: unknown): void
  /** Whether a render picked up now must wait its turn: a shortage was seen lately and another render is running. */
  mustWaitTurn(): boolean
  /** A render's processing began / ended (the whole job, not only its frames). */
  enter(): void
  leave(): void
}

export function createRenderWatch(deps: RenderWatchDeps): RenderWatch {
  let encoderDeathAt: number | undefined
  let encoderReport = ""
  let running = 0

  /** `at` when it is recent enough to make renders suspects. */
  const recent = (at: number | undefined, now: number): number | undefined =>
    at !== undefined && now - at < SHORTAGE_SUSPECT_MS ? at : undefined

  return {
    track() {
      const beganAt = deps.now()
      let progressAt = beganAt
      let frameCount: number | undefined
      let parallelEncoding = false
      let rendered = 0
      let encoded = 0
      return {
        started(info) {
          frameCount = info.frameCount
          parallelEncoding = info.parallelEncoding
          progressAt = deps.now()
        },
        progress(frames) {
          // Frames are encoded in order, so a render whose encoder is gone, or
          // that waits on one frame, still draws later frames: while frames
          // are encoded as they are drawn, only an encoded frame is progress.
          const encoding = parallelEncoding && (frameCount === undefined || encoded < frameCount)
          const advanced = encoding ? frames.encodedFrames > encoded : frames.renderedFrames > rendered || frames.encodedFrames > encoded
          rendered = Math.max(rendered, frames.renderedFrames)
          encoded = Math.max(encoded, frames.encodedFrames)
          if (advanced) progressAt = deps.now()
        },
        stuck() {
          const now = deps.now()
          const refusedAt = recent(deps.lastRefusalAt(), now)
          const diedAt = recent(encoderDeathAt, now)
          if (refusedAt === undefined && diedAt === undefined) return undefined
          const idleFor = now - Math.max(refusedAt ?? 0, diedAt ?? 0, progressAt)
          if (idleFor < SHORTAGE_STALL_MS) return undefined
          const frames = `${rendered} frames drawn, ${encoded} encoded${frameCount === undefined ? "" : ` of ${frameCount}`}`
          // The kernel's refusal is the evidence of a shortage; the renderer's report alone is an encoder that failed.
          if (refusedAt !== undefined) {
            return new RenderShortageError(`no progress for ${Math.round(idleFor / 1000)} s after the container refused a process or thread (${frames})`)
          }
          return new RenderEncoderError(`no progress for ${Math.round(idleFor / 1000)} s after the renderer reported that an encoder quit (${frames})${encoderReport ? `: ${encoderReport}` : ""}`)
        },
        sawShortage() {
          const refusedAt = deps.lastRefusalAt()
          return refusedAt !== undefined && refusedAt >= beganAt - SHORTAGE_SUSPECT_MS
        },
      }
    },
    noteEncoderDeath(report) {
      encoderDeathAt = deps.now()
      // The end of what the renderer said: the encoder's last lines, after its banner.
      const text = report instanceof Error ? report.message : typeof report === "string" ? report : ""
      encoderReport = text.replace(/\s+/g, " ").trim().slice(-400)
    },
    mustWaitTurn() {
      const refusedAt = deps.lastRefusalAt()
      return running >= 1 && refusedAt !== undefined && deps.now() - refusedAt < SHORTAGE_SERIAL_MS
    },
    enter() {
      running += 1
    },
    leave() {
      running = Math.max(0, running - 1)
    },
  }
}

let watch: RenderWatch | undefined

/** This process's watch, reading the kernel's refusal count through the process's shortage observer. */
export function renderWatch(): RenderWatch {
  watch ??= createRenderWatch({
    now: () => Date.now(),
    lastRefusalAt: () => {
      const observer = processShortageObserver("render-worker")
      observer.look()
      return observer.lastRefusalAt()
    },
  })
  return watch
}
