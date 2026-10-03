import { Command } from "commander"
import { readFileSync } from "node:fs"
import type { Edl, Transcript, EditPlanSource, EditPlanInput, SilenceRanges, AudioSyncSource, CameraSwitchInput } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import { warn, type OutputOpts } from "../output.js"
import { reportQueuedJob, collectVariadic } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface WatchOpts {
  watch?: boolean
  pollInterval?: number
}

/**
 * Read + JSON-parse a file into an arbitrary value (transcript / EDL / silence /
 * a full sources array). Unlike `loadParamsFile` this accepts ANY top-level JSON:
 * an EDL / transcript / silence result is an object (silence is the
 * silence-detect job's `output_data.json` = `{ version, ranges, durationMs }`),
 * while `--sources-file` is a top-level array (guarded at its call site).
 */
function readJsonFile(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
}

/**
 * Parse one `--source <[id=]url[@kind]>` spec into an `EditPlanSource`.
 * `@audio` / `@video` after the URL sets the medium (default video). `id=`
 * before the URL names the source — use the id you gave `edit audio-sync` so
 * `--offsets` matches it; without it the id is minted from the row's position
 * (`source-1`, `source-2`, …, the same ids `edit audio-sync` mints). Full
 * control over roles / speakers / offsets is available via `--sources-file`.
 */
function parseSourceSpec(spec: string, index: number): EditPlanSource {
  const named = /^([^=\s]{1,200})=(https?:\/\/.+)$/.exec(spec)
  const id = named ? named[1]! : `source-${index + 1}`
  const rest = named ? named[2]! : spec
  const at = rest.lastIndexOf("@")
  if (at > 0) {
    const suffix = rest.slice(at + 1)
    if (suffix === "audio" || suffix === "video") {
      return { id, url: rest.slice(0, at), kind: suffix }
    }
  }
  return { id, url: rest, kind: "video" }
}

/**
 * Parse one `--source <[id=]url>` spec for `edit audio-sync`. `id=` before the
 * URL names the recording (its offset's `sourceId`); without it the id is
 * minted from the row's position (`source-1`, `source-2`, …).
 */
function parseAudioSyncSource(spec: string, index: number): AudioSyncSource {
  const named = /^([^=\s]{1,200})=(https?:\/\/.+)$/.exec(spec)
  return named ? { id: named[1]!, url: named[2]! } : { id: `source-${index + 1}`, url: spec }
}

export function editCommand(): Command {
  const cmd = new Command("edit").description(
    "editorial primitives for podcast / long-form video — detect silence, sync recordings, apply an EDL, plan a cut",
  )

  // ── silence-detect ────────────────────────────────────────────────────────
  cmd
    .command("silence-detect <audioUrl>")
    .description("detect silence ranges in an audio or video source (ffmpeg, keyless)")
    .option("--threshold-db <dbfs>", "dBFS threshold, ≤ 0 (write a negative as --threshold-db=-35)", (v) => Number(v))
    .option("--min-silence-ms <ms>", "minimum silence length to report", (v) => parseInt(v, 10))
    .option("--pad-ms <ms>", "padding kept around speech", (v) => parseInt(v, 10))
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        audioUrl: string,
        opts: GlobalOpts & WatchOpts & { thresholdDb?: number; minSilenceMs?: number; padMs?: number },
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.silenceDetect({
            audioUrl,
            ...(opts.thresholdDb !== undefined ? { thresholdDb: opts.thresholdDb } : {}),
            ...(opts.minSilenceMs !== undefined ? { minSilenceMs: opts.minSilenceMs } : {}),
            ...(opts.padMs !== undefined ? { padMs: opts.padMs } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: "silence-detect",
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── audio-sync ────────────────────────────────────────────────────────────
  cmd
    .command("audio-sync")
    .description("measure how far apart 2-6 recordings' clocks are, from their sound (keyless)")
    .option(
      "--source <[id=]url>",
      "a recording (audio or video) as url or id=url (repeatable, 2-6); ids are minted as source-N when omitted",
      collectVariadic,
    )
    .option("--sources-file <file>", "JSON array of { id, url } rows (overrides --source)")
    .option("--reference <id>", "the source every offset is measured against (default: the first)")
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (opts: GlobalOpts & WatchOpts & { source?: string[]; sourcesFile?: string; reference?: string }) => {
        let sources: AudioSyncSource[]
        if (opts.sourcesFile) {
          const parsed = readJsonFile(opts.sourcesFile)
          if (!Array.isArray(parsed)) {
            warn(`--sources-file ${opts.sourcesFile} must contain a JSON array of { id, url } rows`)
            process.exit(1)
          }
          sources = parsed as AudioSyncSource[]
        } else {
          sources = (opts.source ?? []).map(parseAudioSyncSource)
        }
        if (sources.length < 2 || sources.length > 6) {
          warn(`audio-sync takes 2-6 recordings — pass --source <url> (repeatable) or --sources-file <file> (got ${sources.length})`)
          process.exit(1)
        }
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.audioSync({
            sources,
            ...(opts.reference !== undefined ? { reference: opts.reference } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: `audio-sync (${sources.length} sources)`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── apply-edl ─────────────────────────────────────────────────────────────
  cmd
    .command("apply-edl")
    .description("render an edit decision list into a video or audio cut")
    .requiredOption("--edl <file>", "path to a JSON file holding the EDL")
    .option("--transcript <file>", "optional transcript JSON to remap through the cut")
    .option("--source <url>", "positional media-URL override for edl.sources[i] (repeatable)", collectVariadic)
    .option("--output <kind>", "video | audio", "video")
    .option("--quality <q>", "proxy | final", "final")
    .option("--crossfade-ms <ms>", "default crossfade on boundaries with no transition", (v) => parseInt(v, 10))
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts &
          WatchOpts & {
            edl: string
            transcript?: string
            source?: string[]
            output: string
            quality: string
            crossfadeMs?: number
          },
      ) => {
        if (opts.output !== "video" && opts.output !== "audio") {
          warn(`--output must be "video" or "audio" (got "${opts.output}")`)
          process.exit(1)
        }
        if (opts.quality !== "proxy" && opts.quality !== "final") {
          warn(`--quality must be "proxy" or "final" (got "${opts.quality}")`)
          process.exit(1)
        }
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.applyEdl({
            edl: readJsonFile(opts.edl) as Edl,
            ...(opts.source && opts.source.length > 0 ? { sources: opts.source } : {}),
            ...(opts.transcript ? { transcript: readJsonFile(opts.transcript) as Transcript } : {}),
            output: opts.output,
            quality: opts.quality,
            ...(opts.crossfadeMs !== undefined ? { crossfadeMs: opts.crossfadeMs } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: `apply-edl (${opts.output})`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── plan (edit-plan) ──────────────────────────────────────────────────────
  cmd
    .command("plan")
    .description("plan a transcript-driven cut / clips / chapters (Cloud edition)")
    .requiredOption("--mode <mode>", "tighten | clips | chapters")
    .requiredOption("--plan-tier <tier>", "economy | standard | premium")
    .requiredOption("--transcript <file>", "path to a timed transcript JSON file")
    .option("--silence <file>", "optional silence JSON — the silence-detect job's output_data.json ({ version, ranges, durationMs })")
    .option(
      "--source <url>",
      "a media source as [id=]url[@audio|@video] (repeatable); id defaults to source-N, kind to video",
      collectVariadic,
    )
    .option("--sources-file <file>", "JSON array of full EditPlanSource rows (overrides --source)")
    .option(
      "--offsets <file>",
      "multicam: an audio-sync result JSON (the job's output_data.json) over the same source ids — each source's measured offset is applied before the request",
    )
    .option("--transcript-source <id>", "the id of the source the transcript was made from (refused if it is off the master's clock)")
    .option("--instructions <text>", "free-text editing steer")
    .option("--style-guide <text>", "style guide applied to the plan")
    .option("--count <n>", "clips mode: how many clips to cut", (v) => parseInt(v, 10))
    .option("--target-duration-sec <n>", "clips mode: target duration per clip (seconds)", (v) => parseInt(v, 10))
    .option("--target-aspect <ratio>", "clips aspect: 16:9 | 9:16 | 1:1 | 4:5")
    .option("--platform <name>", "target platform hint")
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts &
          WatchOpts & {
            mode: string
            planTier: string
            transcript: string
            silence?: string
            source?: string[]
            sourcesFile?: string
            offsets?: string
            transcriptSource?: string
            instructions?: string
            styleGuide?: string
            count?: number
            targetDurationSec?: number
            targetAspect?: string
            platform?: string
          },
      ) => {
        if (opts.mode !== "tighten" && opts.mode !== "clips" && opts.mode !== "chapters") {
          warn(`--mode must be "tighten", "clips" or "chapters" (got "${opts.mode}")`)
          process.exit(1)
        }
        if (opts.planTier !== "economy" && opts.planTier !== "standard" && opts.planTier !== "premium") {
          warn(`--plan-tier must be "economy", "standard" or "premium" (got "${opts.planTier}")`)
          process.exit(1)
        }
        if (
          opts.targetAspect !== undefined &&
          !["16:9", "9:16", "1:1", "4:5"].includes(opts.targetAspect)
        ) {
          warn(`--target-aspect must be one of 16:9, 9:16, 1:1, 4:5 (got "${opts.targetAspect}")`)
          process.exit(1)
        }
        let sources: EditPlanSource[]
        if (opts.sourcesFile) {
          const parsed = readJsonFile(opts.sourcesFile)
          if (!Array.isArray(parsed)) {
            warn(`--sources-file ${opts.sourcesFile} must contain a JSON array of source rows`)
            process.exit(1)
          }
          sources = parsed as EditPlanSource[]
        } else {
          sources = (opts.source ?? []).map(parseSourceSpec)
        }
        if (sources.length === 0) {
          warn("at least one source is required — pass --source <url> (repeatable) or --sources-file <file>")
          process.exit(1)
        }
        try {
          const client = buildClient(opts.profile)
          const input: EditPlanInput = {
            mode: opts.mode,
            planTier: opts.planTier,
            transcript: readJsonFile(opts.transcript) as Transcript,
            sources,
            ...(opts.silence ? { silence: readJsonFile(opts.silence) as SilenceRanges } : {}),
            ...(opts.offsets ? { offsets: readJsonFile(opts.offsets) as EditPlanInput["offsets"] } : {}),
            ...(opts.transcriptSource ? { transcriptSourceId: opts.transcriptSource } : {}),
            ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
            ...(opts.styleGuide !== undefined ? { styleGuide: opts.styleGuide } : {}),
            ...(opts.count !== undefined ? { count: opts.count } : {}),
            ...(opts.targetDurationSec !== undefined ? { targetDurationSec: opts.targetDurationSec } : {}),
            ...(opts.targetAspect !== undefined ? { targetAspect: opts.targetAspect as EditPlanInput["targetAspect"] } : {}),
            ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
          }
          const result = await client.edit.editPlan(input)
          await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: `edit-plan (${opts.mode})`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── switch-cameras (podcast B5) ─────────────────────────────────────────
  cmd
    .command("switch-cameras")
    .description("choose which camera shows each cut of an edit by who is speaking (Cloud edition; flat price)")
    .requiredOption("--edl <file>", "path to ONE EDL JSON (an `edit plan` result)")
    .requiredOption("--transcript <file>", "path to the transcript JSON WITH speaker labels (transcribe with speaker detection)")
    .option("--speaker-map <file>", "JSON object: speaker label → EDL source id of their camera")
    .option("--speaker-names <file>", "JSON object: speaker label → display name")
    .option("--min-shot-ms <ms>", "shortest shot (default 2500)", (v) => parseInt(v, 10))
    .option("--lead-ms <ms>", "cut this long before the new speaker (default 200)", (v) => parseInt(v, 10))
    .option("--max-shot-ms <ms>", "with a wide source: break to it after this long (default 20000)", (v) => parseInt(v, 10))
    .option("--wide-every <n>", "with a wide source: every N-th cut to the wide (default 0 = off)", (v) => parseInt(v, 10))
    .option("--layout-hints", "suggest side-by-side / stacked layouts for crosstalk (Apply EDL renders cut-only edits)")
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts &
          WatchOpts & {
            edl: string
            transcript: string
            speakerMap?: string
            speakerNames?: string
            minShotMs?: number
            leadMs?: number
            maxShotMs?: number
            wideEvery?: number
            layoutHints?: boolean
          },
      ) => {
        try {
          const client = buildClient(opts.profile)
          const input: CameraSwitchInput = {
            edl: readJsonFile(opts.edl) as CameraSwitchInput["edl"],
            transcript: readJsonFile(opts.transcript) as Transcript,
            ...(opts.speakerMap ? { speakerMap: readJsonFile(opts.speakerMap) as Record<string, string> } : {}),
            ...(opts.speakerNames ? { speakerNames: readJsonFile(opts.speakerNames) as Record<string, string> } : {}),
            ...(opts.minShotMs !== undefined ? { minShotMs: opts.minShotMs } : {}),
            ...(opts.leadMs !== undefined ? { leadMs: opts.leadMs } : {}),
            ...(opts.maxShotMs !== undefined ? { maxShotMs: opts.maxShotMs } : {}),
            ...(opts.wideEvery !== undefined ? { wideEvery: opts.wideEvery } : {}),
            ...(opts.layoutHints ? { layoutHints: true } : {}),
          }
          const result = await client.edit.cameraSwitch(input)
          await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: "camera-switch",
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
