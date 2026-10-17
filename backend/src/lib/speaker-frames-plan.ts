/**
 * speaker-frames — the workflow run's reserve (P3.7, decided 2026-10-16). The
 * twin of `speaker-view-plan.ts`.
 *
 * Speaker Frames is priced per started block of 1,000 sampled frames, at one
 * rate (`SPEAKER_FRAMES_CREDITS_PER_BLOCK`, `@nodaro/render-rules`):
 * `rate × max(1, ⌈frames ÷ 1,000⌉)`. Two sites reserve a run and must agree:
 * the cloud plugin's route (`POST /v1/speaker-frames`, a BASE figure its credit
 * guard marks up) and the workflow run (`speakerFramesCreditOverride` below,
 * already marked up) — the workflow run never meets the route. Both count the
 * frames on the SERVER, from the scope the edit resolves to (the validated
 * spans of the ticked sources) and, for a bare video, its probed length
 * (`probeMediaDuration`, the function behind the plugin's
 * `tk.ffmpeg.probeMediaDuration`); never from a number a client sent. Both read
 * the row's rate through `unitRatePrice`, the lookup the whole-run quote reads,
 * so an admin retune moves either lane's reserve with its quote. The cross-repo
 * fixture `__tests__/fixtures/speaker-frames-pricing-cases.json` holds the
 * plugin's frame count and blocks to this rule.
 *
 * The CHARGE is the frames the job actually sampled (a span past the end of
 * its video samples nothing): the plugin's handler commits `rate ×
 * max(1, ⌈sampled ÷ 1,000⌉)` at the rate stamped here
 * (`reservedCreditsPerBlock`), never above the reserve; the rest is released.
 */
import {
  SPEAKER_FRAMES_CREDIT_ID,
  SPEAKER_FRAMES_MAX_SOURCE_MS,
  coerceSpeakerFramesEdits,
  speakerFramesBareVideoFrames,
  speakerFramesBlocks,
  speakerFramesScope,
  speakerFramesScopeFrames,
} from "@nodaro/render-rules"
import { unitRatePrice } from "./credit-base-cost.js"

/** How the reserve learns a bare video's length (seconds). */
export type SpeakerFramesProbe = (url: string) => Promise<number>

const defaultProbe: SpeakerFramesProbe = async (url) => {
  const { probeMediaDuration } = await import("../providers/video/ffmpeg-utils.js")
  return probeMediaDuration(url)
}

/**
 * The frames a Speaker Frames job will sample, counted on the server from the
 * payload the builder made: the scope of its edit and untick list, or a bare
 * video's probed length. A bare video that cannot be probed is counted at the
 * 180 minutes one source may contribute (the job refuses it before sampling
 * and the reserve is refunded). `undefined` for a payload that resolves to no
 * scope (the builder refuses those before any reserve).
 */
export async function speakerFramesReserveFrames(
  payload: Readonly<Record<string, unknown>>,
  probe: SpeakerFramesProbe = defaultProbe,
): Promise<number | undefined> {
  const raw = payload.edl
  const hasEdit = raw !== undefined && raw !== null && raw !== ""
  const videoUrl = typeof payload.videoUrl === "string" && payload.videoUrl ? payload.videoUrl : undefined
  let edits
  if (hasEdit) {
    const coerced = coerceSpeakerFramesEdits(raw)
    if (!coerced.ok) return undefined
    edits = coerced.edits
  }
  const excludeSourceIds = Array.isArray(payload.excludeSourceIds)
    ? (payload.excludeSourceIds as unknown[]).filter((v): v is string => typeof v === "string")
    : undefined
  const scope = speakerFramesScope({
    ...(edits ? { edits } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    ...(edits && excludeSourceIds ? { excludeSourceIds } : {}),
  })
  if (!scope.ok) return undefined
  if (scope.sources.every((s) => s.frames !== null)) return speakerFramesScopeFrames(scope.sources)
  const sec = await probe(videoUrl!).catch(() => undefined)
  const known = typeof sec === "number" && Number.isFinite(sec) && sec > 0
  return known ? speakerFramesBareVideoFrames(sec) : speakerFramesBareVideoFrames(SPEAKER_FRAMES_MAX_SOURCE_MS / 1000)
}

/**
 * The workflow run's reserve (the twin of `speakerViewCreditOverride`): the
 * dispatch bypasses the plugin's route, so it reserves the same base × blocks,
 * marked up. The rate is read from `model_pricing` (an admin row can override
 * it) and stamped on the payload as `reservedCreditsPerBlock` for the
 * handler's commit. `undefined` for any other job, so the `??` chain in
 * node-executor falls through.
 */
export async function speakerFramesCreditOverride(
  jobName: string,
  payload: Record<string, unknown>,
  probe: SpeakerFramesProbe = defaultProbe,
): Promise<number | undefined> {
  if (jobName !== "speaker-frames") return undefined
  const frames = await speakerFramesReserveFrames(payload, probe)
  if (frames === undefined) return undefined
  // ONE read of the row: the rate stamped for the handler's commit, and the
  // reserve — that rate × the blocks, rounded up once (`unitRatePrice`, the
  // composition the plugin's route and the whole-run quote use).
  const { unitBaseCredits, baseCredits } = await unitRatePrice(SPEAKER_FRAMES_CREDIT_ID, speakerFramesBlocks(frames))
  payload.reservedCreditsPerBlock = unitBaseCredits
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  const { getAppSettings } = await import("./app-settings.js")
  return applyServiceMarkup(baseCredits, await getAppSettings(), SPEAKER_FRAMES_CREDIT_ID)
}
