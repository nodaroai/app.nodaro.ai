/**
 * Probe 3 — THE TABLE FIXTURE.
 *
 * The launch gate: the user's exact 30-second, 21:9, 24 fps table prompt,
 * rendered and then measured frame by frame against section 6A of the
 * acceptance spec.
 *
 * The prompt is NOT in this repository. It is an acceptance fixture owned by
 * the private planning repository, and a second copy in a publicly mirrored
 * tree would be both a leak and a copy free to drift from the gate it is
 * supposed to be — so the README says how to fetch it and this probe insists
 * on being handed it.
 *
 * `--video <path>` measures an MP4 that already exists and spends nothing.
 * That is how the measurement half of this probe gets exercised — and how a
 * disputed verdict gets re-judged at a different tolerance — without paying
 * for the same render twice.
 */
import { basename, join } from "node:path"
import { rmSync } from "node:fs"
import { toInt, toNumber } from "../lib/args.mjs"
import { downloadTo, HarnessError, idempotencyKeyFor, makeClient, readBalance, readCapabilities, requireProCapability, stampPrompt } from "../lib/client.mjs"
import { DEFAULT_THRESHOLDS, segmentFrame } from "../lib/color.mjs"
import { evaluateTableFixture, motionSeries, TABLE_CUTS, TABLE_DIMENSIONS, TABLE_FRAME_COUNT } from "../lib/fixture-table.mjs"
import { resolvePrompt } from "../lib/harness.mjs"
import { shortHash } from "../lib/parity.mjs"
import { followJob, phaseTimings, readJobRecord } from "../lib/poll.mjs"
import { promptSourceParams, quoteAndRun, repairEvidence, summarizeProOutput, summarizeQuote } from "../lib/pro.mjs"
import { analysisSize, meanAbsDiff, probeVideo, resolveFfmpeg, resolveFfprobe, streamFrames, swayAndTremor } from "../lib/video.mjs"

export const NAME = "table-fixture"

export async function main(ctx) {
  const { values, args, receipt } = ctx
  const durationSeconds = toNumber(values.duration, "duration", { min: 1, max: 600 })
  const fps = toInt(values.fps, "fps", { min: 1, max: 60 })
  const aspectRatio = values.aspect
  const maxRepairPasses = toInt(values["repair-passes"], "repair-passes", { min: 0, max: 2 })
  const analysisWidth = toInt(values["analysis-width"], "analysis-width", { min: 64, max: 1920 })
  const thresholds = {
    minSubjectArea: toNumber(values["min-subject-area"], "min-subject-area", { min: 0, max: 1 }),
    minShoulderForeground: toNumber(values["min-shoulder-foreground"], "min-shoulder-foreground", { min: 0, max: 1 }),
    windowFrameFraction: toNumber(values["window-frame-fraction"], "window-frame-fraction", { min: 0, max: 1 }),
    cutTolerance: toInt(values["cut-tolerance"], "cut-tolerance", { min: 0, max: 8 }),
  }

  receipt.inputs = { ...receipt.inputs, durationSeconds, fps, aspectRatio, maxRepairPasses, analysisWidth, thresholds, localVideo: values.video ?? null }

  let videoPath = values.video ?? null
  let videoSource = videoPath ? "local file" : "a paid render"

  if (!videoPath) {
    const brief = await resolvePrompt({
      prompt: undefined,
      promptFile: values["prompt-file"],
      fallbackFile: join(process.cwd(), "tools/scene3d-acceptance/fixtures/table-prompt.txt"),
      what: "the table fixture prompt",
    })
    const stampedPrompt = stampPrompt(brief.text, ctx.runId)
    const params = promptSourceParams({ prompt: stampedPrompt, durationSeconds, fps, aspectRatio, maxRepairPasses })
    receipt.inputs.promptSource = brief.source
    receipt.inputs.promptSha = shortHash(brief.text)
    receipt.inputs.promptChars = brief.text.length
    receipt.inputs.request = params
    ctx.save()
    if (ctx.dryRun) return

    const { client } = await makeClient({ baseUrl: args.baseUrl })
    const caps = await readCapabilities(client)
    receipt.inputs.capabilities = caps.raw
    requireProCapability(caps, { aspectRatio, repairPasses: maxRepairPasses })
    receipt.credits.balanceBefore = await readBalance(client)
    ctx.save()

    const key = idempotencyKeyFor(ctx.runId, "table")
    const { quote, jobId } = await quoteAndRun(client, {
      params,
      idempotencyKey: key,
      onQuote: (q) => { receipt.quote = summarizeQuote(q); ctx.save() },
    })
    ctx.recordJob({ jobId, role: "table-fixture", quoteId: quote.quoteId, idempotencyKey: key })
    ctx.log(`table fixture job ${jobId}`)
    const follow = await followJob(client, jobId, {
      pollMs: args.pollMs,
      timeoutMs: args.timeoutMs,
      onTransition: (t) => ctx.log(`  ${t.status}${t.phase ? `/${t.phase}` : ""}${t.progress === null ? "" : ` ${t.progress}%`} @${Math.round(t.elapsedMs / 1000)}s`),
    })
    const job = await readJobRecord(client, jobId)
    const output = follow.output ?? job?.output_data ?? null
    const summary = summarizeProOutput(output)
    receipt.timings.render = phaseTimings(job, follow)
    receipt.outputs.render = summary
    receipt.measurements.repairs = repairEvidence({ output, quote, requested: maxRepairPasses })
    receipt.credits.balanceAfter = await readBalance(client)
    receipt.credits.committed = job?.credit_status === "committed" ? job?.credits ?? null : 0
    ctx.recordJob({ jobId, role: "table-fixture", terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null, errorMessage: job?.error_message ?? null })
    ctx.save()

    if (!ctx.assert("the table fixture rendered", { expected: "completed", actual: follow.terminalStatus, detail: job?.error_message ?? undefined })) return
    ctx.assert("credits committed", { expected: "committed", actual: job?.credit_status ?? null })
    ctx.assert("validation status passed", { expected: "passed", actual: summary?.validation?.status ?? null })
    if (!summary?.videoUrl) {
      ctx.assert("a video url was published", { expected: "a video url", actual: null, pass: false })
      return
    }
    const work = ctx.workDir()
    videoPath = join(work, `table-${ctx.runId}.mp4`)
    const downloaded = await downloadTo(summary.videoUrl, videoPath)
    receipt.outputs.download = { path: basename(videoPath), byteLength: downloaded.byteLength, host: new URL(summary.videoUrl).host }
    videoSource = summary.videoUrl
    ctx.save()
  } else if (ctx.dryRun) {
    ctx.save()
    return
  }

  await measure(ctx, { videoPath, videoSource, fps, durationSeconds, thresholds, analysisWidth, keepFrames: values["keep-frames"] === true })
}

/** Decode once, and derive every number the contract asks about from that pass. */
async function measure(ctx, { videoPath, videoSource, fps, durationSeconds, thresholds, analysisWidth, keepFrames }) {
  const { receipt } = ctx
  const ffmpeg = resolveFfmpeg()
  const ffprobe = resolveFfprobe()
  const probe = probeVideo(ffprobe.path, videoPath)
  receipt.measurements.decoder = { ffmpeg: ffmpeg.version, ffprobe: ffprobe.version, ffmpegPath: ffmpeg.path }
  receipt.measurements.container = { ...probe, source: videoSource }
  ctx.save()

  ctx.assert("the export is the contract's raster", {
    expected: TABLE_DIMENSIONS,
    actual: { width: probe.width, height: probe.height },
    pass: probe.width === TABLE_DIMENSIONS.width && probe.height === TABLE_DIMENSIONS.height,
  })
  ctx.assert("the export runs at the requested frame rate", {
    expected: fps,
    actual: probe.fps,
    pass: typeof probe.fps === "number" && Math.abs(probe.fps - fps) < 0.01,
    detail: `r_frame_rate ${probe.rFrameRate}`,
  })
  const expectedFrames = Math.round(durationSeconds * fps)
  ctx.assert("the export holds the contract's frame count", {
    expected: expectedFrames,
    actual: probe.frames,
    pass: probe.frames === expectedFrames,
    detail: expectedFrames === TABLE_FRAME_COUNT ? "720 frames = 30s at 24fps" : undefined,
  })

  const { width, height } = analysisSize(probe.width, probe.height, analysisWidth)
  const segments = []
  const diffs = [0]
  let previous = null
  const decodeStarted = Date.now()
  const decoded = await streamFrames(ffmpeg.path, videoPath, {
    width,
    height,
    onFrame: (frame) => {
      segments.push(segmentFrame(frame, width, height, DEFAULT_THRESHOLDS))
      if (previous) diffs.push(meanAbsDiff(previous, frame))
      previous = Buffer.from(frame)
    },
  })
  receipt.timings.analysis = { decodeMs: Date.now() - decodeStarted, framesDecoded: decoded.frames, raster: { width, height } }
  ctx.log(`decoded and segmented ${decoded.frames} frames at ${width}x${height}`)

  const verdict = evaluateTableFixture({ segments, diffs, fps, cuts: TABLE_CUTS, thresholds })
  const motion = motionSeries(segments)
  receipt.measurements.segmentation = { thresholds: DEFAULT_THRESHOLDS, raster: { width, height } }
  receipt.measurements.cuts = verdict.cuts
  receipt.measurements.windows = verdict.windows
  receipt.measurements.motion = {
    camera: swayAndTremor(motion.camera),
    subject: swayAndTremor(motion.subject),
    reading: "camera = the neutral grey room/table centroid (moves only with the camera); subject = mean identity-colour centroid (camera + breathing). Recorded as a heuristic; the prompt's 'slow handheld, not wiggle' is a human judgement on these numbers.",
  }
  receipt.measurements.perFrameDiffSample = diffs.map((d, i) => ({ frame: i, diff: Number(d.toFixed(3)) })).filter(({ frame }) => TABLE_CUTS.some((cut) => Math.abs(frame - cut) <= 2))
  ctx.save()

  for (const cut of verdict.cuts.expected) {
    ctx.assert(`hard cut at frame ${cut.expectedIndex}`, {
      expected: `a spike at ${cut.expectedIndex} (±${verdict.cuts.tolerance})`,
      actual: cut.matchedIndex === null ? "no spike" : `spike at ${cut.matchedIndex}`,
      pass: cut.pass,
      detail: `diff ${cut.boundary.diff.toFixed(2)} vs neighbours ${cut.boundary.diffBefore.toFixed(2)}/${cut.boundary.diffAfter.toFixed(2)}; ratio ${cut.boundary.spikeRatio === null ? "inf" : cut.boundary.spikeRatio.toFixed(2)}, neighbour share ${cut.boundary.neighbourShare === null ? "inf" : cut.boundary.neighbourShare.toFixed(3)}`,
    })
  }
  ctx.assert("no cut where the fixture does not name one", {
    expected: TABLE_CUTS,
    actual: verdict.cuts.detectedIndices,
    pass: verdict.cuts.unexpectedIndices.length === 0,
    detail: `unexpected: ${JSON.stringify(verdict.cuts.unexpectedIndices)}`,
  })

  for (const window of verdict.windows) {
    for (const check of window.checks) {
      ctx.assert(`shot ${window.index + 1} (${window.from}-${window.to - 1}): ${check.what}`, {
        expected: `${check.stats.key} ≥ ${check.stats.floor} on ≥${Math.round(verdict.thresholds.windowFrameFraction * 100)}% of frames`,
        actual: `${(check.stats.fraction * 100).toFixed(1)}% of ${check.stats.frames} frames; mean ${check.stats.mean === null ? "n/a" : check.stats.mean.toFixed(5)}, max ${check.stats.max === null ? "n/a" : check.stats.max.toFixed(5)}`,
        pass: check.pass,
      })
    }
  }

  if (!keepFrames && videoPath.includes(`work-${NAME}-${ctx.runId}`)) {
    try {
      rmSync(ctx.workDir(), { recursive: true, force: true })
    } catch { /* the receipt is what matters; a stray work dir is not worth a failure */ }
  }
}

export { HarnessError }
