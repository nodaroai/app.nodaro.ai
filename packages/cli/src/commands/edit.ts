import { Command } from "commander"
import { readFileSync } from "node:fs"
import {
  EDIT_PLAN_MODES,
  type EditPlanMode,
  EDIT_PLAN_TIERS,
  EDL_TARGET_ASPECTS,
  SPEAKER_LAYOUT_IDS,
} from "@nodaro/shared/edl"
import type { Edl, Transcript, EditPlanSource, EditPlanInput, SilenceRanges, AudioSyncSource, CameraSwitchInput } from "@nodaro/sdk"
import { ContinuationRefusedError, type TightenEpisodeInput } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import pc from "picocolors"
import { emit, warn, type OutputOpts } from "../output.js"
import { reportQueuedJob, collectVariadic } from "../util.js"

function isEditPlanMode(v: string): v is EditPlanMode {
  return (EDIT_PLAN_MODES as readonly string[]).includes(v)
}

/** What to do with the job a continuation refusal names, by its code. */
const CONTINUATION_NEXT_STEP: Readonly<Record<string, (jobId: string) => string>> = {
  already_running: (id) => ` — follow it: nodaro jobs get ${id}`,
  continuation_superseded: (id) => ` — continue that one: nodaro edit continue-use-case ${id} --mode from-failed`,
  render_final_already_rendered: (id) => ` — its result is the one to use: nodaro jobs get ${id}`,
}

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
    .option(
      "--clip-key <key>",
      'the plan clip this render cuts, "<first inMs>-<last outMs>" of a clips-mode plan clip; stamped back on the result as clipKey',
    )
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
            clipKey?: string
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
            ...(opts.clipKey !== undefined ? { clipKey: opts.clipKey } : {}),
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

  // ── tighten-episode (podcast use-case node) ─────────────────────────────
  const framingLayouts: readonly string[] = ["auto", ...SPEAKER_LAYOUT_IDS]
  cmd
    .command("tighten-episode")
    .description("tighten a podcast recording in one step (transcribe, cut silences, render; optional captions, music and framing)")
    .requiredOption("--media <url>", "the recording (video or audio URL, up to 3 hours)")
    .option("--music <url>", "optional music bed, ducked under the voice")
    .option("--output <kind>", "video | audio (an audio recording always makes an audio episode)")
    .option("--framing <aspect>", `frame a video episode on its speakers: ${EDL_TARGET_ASPECTS.join(" | ")}`)
    .option("--layout <layout>", `layout with --framing (default auto): ${framingLayouts.join(" | ")}`)
    .option("--no-captions", "no captions on a video episode")
    .option("--review", "stop at a preview to review (render the final with `nodaro edit continue-use-case <jobId> --mode render-final`)")
    .option("--plan-tier <tier>", EDIT_PLAN_TIERS.join(" | "))
    .option("--instructions <text>", "editing instructions for the planner")
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts &
          WatchOpts & {
            media: string
            music?: string
            output?: string
            framing?: string
            layout?: string
            captions: boolean
            review?: boolean
            planTier?: string
            instructions?: string
          },
      ) => {
        if (opts.output !== undefined && opts.output !== "video" && opts.output !== "audio") {
          warn(`--output must be "video" or "audio" (got "${opts.output}")`)
          process.exit(1)
        }
        if (opts.planTier !== undefined && !(EDIT_PLAN_TIERS as readonly string[]).includes(opts.planTier)) {
          warn(`--plan-tier must be ${EDIT_PLAN_TIERS.join(", ")} (got "${opts.planTier}")`)
          process.exit(1)
        }
        if (opts.framing !== undefined && !(EDL_TARGET_ASPECTS as readonly string[]).includes(opts.framing)) {
          warn(`--framing must be ${EDL_TARGET_ASPECTS.join(", ")} (got "${opts.framing}")`)
          process.exit(1)
        }
        if (opts.layout !== undefined && opts.framing === undefined) {
          warn("--layout applies with --framing only (it picks the framed layout)")
          process.exit(1)
        }
        if (opts.layout !== undefined && !framingLayouts.includes(opts.layout)) {
          warn(`--layout must be ${framingLayouts.join(", ")} (got "${opts.layout}")`)
          process.exit(1)
        }
        type Framing = NonNullable<TightenEpisodeInput["framing"]>
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.tightenEpisode({
            mediaUrl: opts.media,
            ...(opts.music ? { musicUrl: opts.music } : {}),
            ...(opts.output ? { output: opts.output as "video" | "audio" } : {}),
            ...(opts.framing
              ? { framing: { aspect: opts.framing as Framing["aspect"], layout: (opts.layout ?? "auto") as Framing["layout"] } }
              : {}),
            // commander's --no-captions defaults `captions` to true: send it only when turned off.
            ...(opts.captions === false ? { captions: false } : {}),
            ...(opts.review ? { reviewBeforeRender: true } : {}),
            ...(opts.planTier ? { planTier: opts.planTier as NonNullable<TightenEpisodeInput["planTier"]> } : {}),
            ...(opts.instructions ? { instructions: opts.instructions } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: "tighten-episode",
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── continue-use-case (Tighten Episode runs) ────────────────────────────
  cmd
    .command("continue-use-case <jobId>")
    .description("continue a Tighten Episode run as a new job: from where it failed, or its Render final after a review")
    .requiredOption("--mode <mode>", "from-failed | render-final")
    .option("--edit <file>", "render-final only: a JSON file holding the reviewer's edit of the plan (an EDL)")
    .option("--idempotency-key <key>", "sent as Idempotency-Key: a retry with the same key answers the run already started")
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: GlobalOpts & WatchOpts & { mode: string; edit?: string; idempotencyKey?: string }) => {
      if (opts.mode !== "from-failed" && opts.mode !== "render-final") {
        warn(`--mode must be "from-failed" or "render-final" (got "${opts.mode}")`)
        process.exit(1)
      }
      if (opts.edit !== undefined && opts.mode !== "render-final") {
        warn("--edit applies to --mode render-final only")
        process.exit(1)
      }
      try {
        const client = buildClient(opts.profile)
        const result = await client.edit.continueUseCase(
          {
            jobId,
            mode: opts.mode,
            ...(opts.edit !== undefined ? { editedEdl: readJsonFile(opts.edit) } : {}),
          },
          opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
        )
        await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
          json: opts.json,
          watch: opts.watch,
          pollInterval: opts.pollInterval,
          note: `continue-use-case (${opts.mode})`,
        })
      } catch (err) {
        // A refusal that names another job: say which, and what to do with it.
        // Under --json the documented refusal shape goes to stdout (scripts need the
        // jobId); otherwise stderr, in handleError's style, plus the job and what next.
        if (err instanceof ContinuationRefusedError) {
          if (opts.json) {
            emit({ error: { code: err.code, message: err.message }, jobId: err.jobId }, opts)
          } else {
            console.error(pc.red(`✗ ${err.message}`))
            console.error(pc.dim(`  code: ${err.code}`))
            console.error(pc.dim(`  job: ${err.jobId}${CONTINUATION_NEXT_STEP[err.code]?.(err.jobId) ?? ""}`))
          }
          process.exit(1)
        }
        handleError(err)
      }
    })

  // ── plan (edit-plan) ──────────────────────────────────────────────────────
  cmd
    .command("plan")
    .description("plan a transcript-driven cut / clips / chapters / trailer (Cloud edition)")
    .requiredOption("--mode <mode>", EDIT_PLAN_MODES.join(" | "))
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
    .option("--target-aspect <ratio>", "clips / trailer aspect: 16:9 | 9:16 | 1:1 | 4:5")
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
        // The shared list is the single source of truth, so a mode the SDK and
        // MCP accept is never refused here.
        if (!isEditPlanMode(opts.mode)) {
          warn(`--mode must be one of ${EDIT_PLAN_MODES.join(", ")} (got "${opts.mode}")`)
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
