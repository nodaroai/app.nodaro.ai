/**
 * Probe 5 — THE CONTROLLED A/B, WITH THE SCOPING LINE.
 *
 * One matched pair on the same model, duration, resolution, aspect ratio and
 * audio setting, sharing one image reference and one common prompt. Arm B adds
 * the clay video reference AND the sentence that scopes it.
 *
 * The scoping line is the variable under test. The 2026-09-10 greybox
 * experiment found that a layout reference without one gives a blockout back —
 * the model reads the clay look as part of the brief — so this rerun is the
 * earlier A/B with that finding applied, not a repeat of it.
 *
 * Two properties this probe is built to protect:
 *
 *  - PARITY IS CHECKED SERVER-SIDE. Two locally identical bodies can arrive as
 *    two different requests; a route that normalizes, defaults or injects a
 *    field would break the experiment silently. So both jobs' stored
 *    `input_data` is read back and diffed, and anything differing beyond
 *    prompt / userPrompt / referenceVideoUrls fails the run.
 *  - THE PIXEL MEASUREMENT IS EVIDENCE, NOT A VERDICT. The published pilot's
 *    own note stands: thresholding cannot tell occlusion from leaving frame.
 *    The red-timing table is recorded; the pass/fail belongs to the contract
 *    and to a human looking at the frames.
 */
import { basename, join } from "node:path"
import { toInt, toNumber } from "../lib/args.mjs"
import { downloadTo, HarnessError, idempotencyKeyFor, makeClient, readBalance, stampPrompt, submitOnce } from "../lib/client.mjs"
import { countPilotRed, longestAbsenceWindow, PILOT_RED_THRESHOLDS } from "../lib/color.mjs"
import { resolvePrompt } from "../lib/harness.mjs"
import { compareInputs, comparePromptBodies, shortHash } from "../lib/parity.mjs"
import { followJob, phaseTimings, readJobRecord } from "../lib/poll.mjs"
import { resolveScopingLine } from "../lib/scoping.mjs"
import { analysisSize, probeVideo, resolveFfmpeg, resolveFfprobe, streamFrames } from "../lib/video.mjs"

export const NAME = "seedance-ab"

/** The keys the experiment DELIBERATELY varies. Everything else must match. */
export const ALLOWED_DIFFERING_KEYS = Object.freeze(["prompt", "userPrompt", "referenceVideoUrls"])

export async function main(ctx) {
  const { values, args, receipt } = ctx
  const arm = String(values.arm ?? "both").toLowerCase()
  if (!["both", "a", "b"].includes(arm)) throw new HarnessError(`--arm must be both|a|b, got "${values.arm}"`, { code: "bad_arm" })
  const imageRef = values["image-ref"]
  const clayRef = values["clay-ref"]
  if (!imageRef) throw new HarnessError("--image-ref is required (both arms share it)", { code: "no_reference", hint: "the frozen A/B input URLs are in the private controlled-A/B document — see README.md" })
  if (arm !== "a" && !clayRef) throw new HarnessError("--clay-ref is required for arm B", { code: "no_reference" })

  const common = await resolvePrompt({ prompt: values.prompt, promptFile: values["prompt-file"], what: "the common A/B prompt" })
  const scoping = await resolveScopingLine({ cli: values["scoping-line"] })
  const duration = toInt(values.duration, "duration", { min: 1, max: 60 })
  const resolution = values.resolution
  const aspectRatio = values.aspect
  const provider = values.provider
  const sound = values.sound === true
  const imageField = values["image-ref-field"]
  if (!["referenceImageUrls", "imageUrl"].includes(imageField)) {
    throw new HarnessError(`--image-ref-field must be referenceImageUrls or imageUrl, got "${imageField}"`, { code: "bad_reference_field" })
  }
  const analysisWidth = toInt(values["analysis-width"], "analysis-width", { min: 64, max: 1920 })
  const centralFraction = toNumber(values["central-fraction"], "central-fraction", { min: 0.05, max: 1 })

  // Arm B is arm A plus one sentence. The run stamp goes on the SHARED body so
  // B still starts with A verbatim — the parity check depends on it.
  const promptA = stampPrompt(common.text, ctx.runId)
  const promptB = `${promptA}\n\n${scoping.line}`
  const imagePart = imageField === "imageUrl" ? { imageUrl: imageRef } : { referenceImageUrls: [imageRef] }
  const base = { provider, duration, resolution, aspectRatio, sound, ...imagePart }
  const bodies = {
    a: { ...base, prompt: promptA },
    b: { ...base, prompt: promptB, referenceVideoUrls: [clayRef] },
  }

  receipt.inputs = {
    ...receipt.inputs,
    provider, duration, resolution, aspectRatio, sound, imageField, arm,
    promptSource: common.source,
    commonPromptSha: shortHash(promptA),
    commonPromptChars: promptA.length,
    scopingLine: scoping.line,
    scopingLineSource: scoping.source,
    scopingLineExport: scoping.exportName,
    scopingLineNote: scoping.note ?? null,
    imageRefHost: hostOf(imageRef),
    imageRefSha: shortHash(imageRef),
    clayRefHost: clayRef ? hostOf(clayRef) : null,
    clayRefSha: clayRef ? shortHash(clayRef) : null,
    analysisWidth, centralFraction,
    requests: { a: { ...bodies.a, prompt: `<sha ${shortHash(promptA)}>` }, b: { ...bodies.b, prompt: `<sha ${shortHash(promptB)}>` } },
  }
  ctx.save()

  const bodyCheck = comparePromptBodies(promptA, promptB)
  receipt.measurements.promptBodies = bodyCheck
  ctx.save()
  if (ctx.dryRun) return

  const { client } = await makeClient({ baseUrl: args.baseUrl })
  receipt.credits.balanceBefore = await readBalance(client)
  ctx.save()

  ctx.assert("arm B is arm A plus the scoping line", {
    expected: "arm B starts with arm A verbatim and adds text",
    actual: bodyCheck.armBExtendsArmA ? `added ${bodyCheck.addedText?.length ?? 0} characters` : "arm B does not extend arm A",
    pass: bodyCheck.pass,
  })

  // Both arms are launched together so they meet the same queue and the same
  // deployed model version — sequential arms would differ by however long the
  // first one took.
  const arms = arm === "both" ? ["a", "b"] : [arm]
  const launched = await Promise.all(arms.map(async (name) => {
    const key = idempotencyKeyFor(ctx.runId, `arm-${name}`)
    const { jobId } = await submitOnce(client, { type: "generate-video", params: bodies[name], idempotencyKey: key })
    ctx.recordJob({ jobId, role: `arm-${name}`, nodeType: "generate-video", idempotencyKey: key })
    ctx.log(`arm ${name.toUpperCase()} job ${jobId}`)
    return { name, jobId }
  }))

  const settled = await Promise.all(launched.map(async ({ name, jobId }) => {
    const follow = await followJob(client, jobId, {
      pollMs: args.pollMs,
      timeoutMs: args.timeoutMs,
      onTransition: (t) => ctx.log(`  arm ${name.toUpperCase()} ${t.status}${t.progress === null ? "" : ` ${t.progress}%`} @${Math.round(t.elapsedMs / 1000)}s`),
    })
    const job = await readJobRecord(client, jobId)
    receipt.timings[`arm-${name}`] = phaseTimings(job, follow)
    ctx.recordJob({ jobId, role: `arm-${name}`, terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null, errorMessage: job?.error_message ?? null })
    ctx.save()
    return { name, jobId, follow, job, output: follow.output ?? job?.output_data ?? null }
  }))

  for (const entry of settled) {
    ctx.assert(`arm ${entry.name.toUpperCase()} completed`, { expected: "completed", actual: entry.follow.terminalStatus, detail: entry.job?.error_message ?? undefined })
  }

  if (settled.length === 2) {
    const [a, b] = settled.sort((x, y) => x.name.localeCompare(y.name))
    // `--allow-key` exists so a server field nobody predicted is a FLAG and a
    // recorded decision, not a code change made under time pressure on a run
    // that has already been paid for.
    const allowed = [...ALLOWED_DIFFERING_KEYS, ...(values["allow-key"] ?? [])]
    receipt.inputs.parityAllowedKeys = allowed
    const parity = compareInputs(a.job?.input_data, b.job?.input_data, { allowed })
    receipt.measurements.serverInputParity = parity
    ctx.save()
    ctx.assert("the server stored two inputs differing only in the intended fields", {
      expected: allowed,
      actual: parity.differingKeys,
      pass: parity.pass,
      detail: `unexpected: ${JSON.stringify(parity.unexpectedKeys)}`,
    })
    const refVideosA = countRefVideos(a.job?.input_data)
    const refVideosB = countRefVideos(b.job?.input_data)
    ctx.assert("only arm B carries a reference video", {
      expected: { a: 0, b: 1 },
      actual: { a: refVideosA, b: refVideosB },
      pass: refVideosA === 0 && refVideosB === 1,
    })
  } else {
    ctx.note("one arm only — server input parity needs both arms and was not measured")
  }

  // ---- pixels ------------------------------------------------------------
  const work = ctx.workDir()
  const ffmpeg = resolveFfmpeg()
  const ffprobe = resolveFfprobe()
  receipt.measurements.decoder = { ffmpeg: ffmpeg.version, ffprobe: ffprobe.version }
  const table = []
  for (const entry of settled) {
    const url = typeof entry.output?.videoUrl === "string" ? entry.output.videoUrl : null
    if (!url) {
      ctx.assert(`arm ${entry.name.toUpperCase()} published a video`, { expected: "a video url", actual: null, pass: false })
      continue
    }
    const file = join(work, `arm-${entry.name}-${ctx.runId}.mp4`)
    const downloaded = await downloadTo(url, file)
    const probe = probeVideo(ffprobe.path, file)
    const measured = await measureRed(ffmpeg.path, file, { probe, analysisWidth, centralFraction })
    table.push({
      arm: entry.name,
      jobId: entry.jobId,
      videoUrl: url,
      videoHost: hostOf(url),
      file: basename(file),
      byteLength: downloaded.byteLength,
      container: probe,
      credits: entry.job?.credits ?? null,
      creditStatus: entry.job?.credit_status ?? null,
      elapsedMs: entry.follow.elapsedMs,
      ...measured,
    })
    receipt.measurements.redTiming = table
    ctx.save()
  }
  receipt.measurements.redMethod = {
    thresholds: PILOT_RED_THRESHOLDS,
    centralFraction,
    analysisWidth,
    reading: "kept byte-for-byte as the published pilot ran it, so the two runs are comparable. Supporting evidence only: thresholding cannot distinguish occlusion from leaving frame — inspect the midpoint and final frames.",
  }
  receipt.outputs.arms = table.map(({ arm: name, jobId, videoUrl, videoHost, container, absenceWindow, visibleAtEnd }) =>
    ({ arm: name, jobId, videoUrl, videoHost, container, absenceWindow, visibleAtEnd }))
  receipt.credits.balanceAfter = await readBalance(client)
  receipt.credits.committed = receipt.jobs.reduce((total, entry) => total + (typeof entry.credits === "number" && entry.creditStatus === "committed" ? entry.credits : 0), 0)
  ctx.save()

  ctx.assert("every completed arm was measured", {
    expected: settled.filter((e) => e.follow.terminalStatus === "completed").length,
    actual: table.length,
    pass: table.length === settled.filter((e) => e.follow.terminalStatus === "completed").length,
  })
}

/** Per-frame central and full-frame red, plus the pilot's two derived numbers. */
async function measureRed(ffmpegPath, file, { probe, analysisWidth, centralFraction }) {
  const { width, height } = analysisSize(probe.width, probe.height, analysisWidth)
  const central = []
  const full = []
  await streamFrames(ffmpegPath, file, {
    width,
    height,
    onFrame: (frame) => {
      central.push(countPilotRed(frame, width, height, { centralFraction }))
      full.push(countPilotRed(frame, width, height, { centralFraction: 1 }))
    },
  })
  const fps = probe.fps ?? 24
  const endFrames = full.slice(-3)
  const endMean = endFrames.length === 0 ? 0 : endFrames.reduce((a, b) => a + b, 0) / endFrames.length
  return {
    raster: { width, height },
    frames: central.length,
    absenceWindow: longestAbsenceWindow(central, fps),
    centralRedMean: central.length === 0 ? null : central.reduce((a, b) => a + b, 0) / central.length,
    fullRedMean: full.length === 0 ? null : full.reduce((a, b) => a + b, 0) / full.length,
    endRedMean: endMean,
    visibleAtEnd: endMean >= PILOT_RED_THRESHOLDS.absencePixels,
  }
}

function countRefVideos(inputData) {
  const list = inputData && typeof inputData === "object" ? inputData.referenceVideoUrls : undefined
  return Array.isArray(list) ? list.length : 0
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export { HarnessError }
