// `nodaro edit`'s use-case node commands (the podcast nodes that run a whole
// chain in one step): tighten-episode, episode-chapters, episode-trailer,
// clip-pack, and continue-use-case for their runs. Registered on the `edit`
// command by edit.ts, in this order, after apply-edl.
import type { Command } from "commander"
import {
  EDIT_PLAN_MAX_CLIP_COUNT,
  EDIT_PLAN_TIERS,
  EDL_TARGET_ASPECTS,
  SPEAKER_EMPHASIS_STYLES,
  SPEAKER_LAYOUT_IDS,
  SPEAKER_SWITCH_IDS,
  isKnownSpeakerEmphasisStyle,
} from "@nodaro/shared/edl"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import {
  CLIP_PACK_MAX_TARGET_SEC,
  CLIP_PACK_MIN_TARGET_SEC,
  TRAILER_FORMATS,
  USE_CASE_NODE_TYPES,
  type ClipPackInput,
  type EpisodeChaptersInput,
  type EpisodeTrailerInput,
  type TightenEpisodeInput,
  type TrailerFormat,
  type UseCaseNodeType,
} from "@nodaro/sdk/edit"
import { ContinuationRefusedError, NodaroError } from "@nodaro/sdk/errors"
import { buildClient, handleError } from "../client.js"
import pc from "picocolors"
import { emit, warn } from "../output.js"
import { reportQueuedJob } from "../util.js"
import { readJsonFile, refuseUnknownPlanTier, type GlobalOpts, type WatchOpts } from "./edit-shared.js"
import { recordingsInput, withRecordingsOptions, type RecordingsOpts } from "./edit-recordings.js"

/** The emphasis values Speaker View draws: "none", or its atoms joined with "+" (each once). */
const EMPHASIS_HELP = `none, or ${SPEAKER_EMPHASIS_STYLES.filter((s) => s !== "none").join(", ")} joined with "+" (each once)`

/** What to do with the job a continuation refusal names, by its code. */
const CONTINUATION_NEXT_STEP: Readonly<Record<string, (jobId: string) => string>> = {
  already_running: (id) => ` — follow it: nodaro jobs get ${id}`,
  continuation_superseded: (id) => ` — continue that one: nodaro edit continue-use-case ${id} --mode from-failed`,
  render_final_already_rendered: (id) => ` — its result is the one to use: nodaro jobs get ${id}`,
}

/** Adds the use-case node commands to `cmd` (the `edit` command). */
export function registerUseCaseCommands(cmd: Command): void {
  // ── tighten-episode (podcast use-case node) ─────────────────────────────
  const framingLayouts: readonly string[] = ["auto", ...SPEAKER_LAYOUT_IDS]
  withRecordingsOptions(
    cmd
      .command("tighten-episode")
      .description("tighten a podcast recording in one step (transcribe, cut silences, render; optional captions, music and framing)"),
  )
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
          WatchOpts &
          RecordingsOpts & {
            music?: string
            output?: string
            framing?: string
            layout?: string
            captions: boolean
            review?: boolean
            planTier?: string
            instructions?: string
          },
        command: Command,
      ) => {
        if (opts.output !== undefined && opts.output !== "video" && opts.output !== "audio") {
          warn(`--output must be "video" or "audio" (got "${opts.output}")`)
          process.exit(1)
        }
        refuseUnknownPlanTier(opts.planTier)
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
        const recordings = recordingsInput(opts)
        type Framing = NonNullable<TightenEpisodeInput["framing"]>
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.tightenEpisode({
            ...recordings,
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
            note: command.name(),
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── episode-chapters (podcast use-case node) ────────────────────────────
  cmd
    .command("episode-chapters")
    .description("list a podcast recording's chapters in one step (transcribe, then plan the chapters); with --watch, prints the show notes")
    .requiredOption("--media <url>", "the recording (video or audio URL, up to 3 hours)")
    .option("--plan-tier <tier>", EDIT_PLAN_TIERS.join(" | "))
    .option("--instructions <text>", "instructions for the chapters (\"5 to 8 chapters\")")
    .option("--style-guide <text>", "a style guide for the chapter titles")
    .option("--idempotency-key <key>", "sent as Idempotency-Key: a retry with the same key answers the run already started")
    .option("--watch", "poll the job until it finishes, then print the chapter list")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts &
          WatchOpts & { media: string; planTier?: string; instructions?: string; styleGuide?: string; idempotencyKey?: string },
        command: Command,
      ) => {
        refuseUnknownPlanTier(opts.planTier)
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.episodeChapters(
            {
              mediaUrl: opts.media,
              ...(opts.planTier ? { planTier: opts.planTier as NonNullable<EpisodeChaptersInput["planTier"]> } : {}),
              ...(opts.instructions ? { instructions: opts.instructions } : {}),
              ...(opts.styleGuide ? { styleGuide: opts.styleGuide } : {}),
            },
            opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
          )
          const done = await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: command.name(),
          })
          // The show notes (one `0:00 Title` line per chapter); --json already printed the whole job.
          const text = (done?.data.output_data as { text?: unknown } | null | undefined)?.text
          if (!opts.json && done?.data.status === "completed" && typeof text === "string" && text.length > 0) console.log(text)
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── episode-trailer (podcast use-case node) ─────────────────────────────
  cmd
    .command("episode-trailer")
    .description("cut a 20–40 second trailer of a recording and deliver it in each chosen social format, in one step")
    .requiredOption("--media <url>", "the recording (a video URL, up to 3 hours)")
    .option("--intro-card <url>", "an optional short video (15 s at most) played before the trailer")
    .option("--formats <list>", `comma-separated, at least one: ${TRAILER_FORMATS.join(",")} (default 9:16,1:1,4:5)`)
    .option("--review", "stop at a preview to review (render every format with `nodaro edit continue-use-case <jobId> --mode render-final`)")
    .option("--plan-tier <tier>", EDIT_PLAN_TIERS.join(" | "))
    .option("--instructions <text>", "instructions for the trailer")
    .option("--style-guide <text>", "a style guide for the plan")
    .option("--idempotency-key <key>", "sent as Idempotency-Key: a retry with the same key answers the run already started")
    .option("--watch", "poll the job until it finishes, then print each format's URL")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts &
          WatchOpts & {
            media: string
            introCard?: string
            formats?: string
            review?: boolean
            planTier?: string
            instructions?: string
            styleGuide?: string
            idempotencyKey?: string
          },
      ) => {
        const formats = opts.formats?.split(",").map((f) => f.trim()).filter((f) => f.length > 0)
        if (formats !== undefined && (formats.length === 0 || formats.some((f) => !(TRAILER_FORMATS as readonly string[]).includes(f)))) {
          warn(`--formats must be one or more of ${TRAILER_FORMATS.join(", ")}, comma-separated (got "${opts.formats}")`)
          process.exit(1)
        }
        refuseUnknownPlanTier(opts.planTier)
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.episodeTrailer(
            {
              mediaUrl: opts.media,
              ...(opts.introCard ? { introCardUrl: opts.introCard } : {}),
              ...(formats ? { formats: formats as TrailerFormat[] } : {}),
              ...(opts.review ? { reviewBeforeRender: true } : {}),
              ...(opts.planTier ? { planTier: opts.planTier as NonNullable<EpisodeTrailerInput["planTier"]> } : {}),
              ...(opts.instructions ? { instructions: opts.instructions } : {}),
              ...(opts.styleGuide ? { styleGuide: opts.styleGuide } : {}),
            },
            opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
          )
          const done = await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: "episode-trailer",
          })
          if (opts.json) return
          // The trailers, one line per format, then the formats that could not be rendered (the
          // node's wording); --json already printed the whole job.
          const out = done?.data.output_data as { formats?: unknown; failedFormats?: unknown } | null | undefined
          if (done?.data.status === "completed" && Array.isArray(out?.formats)) {
            for (const f of out.formats as { format?: unknown; url?: unknown }[]) {
              if (typeof f?.format === "string" && typeof f.url === "string") console.log(`${f.format}  ${f.url}`)
            }
            const failed = Array.isArray(out.failedFormats) ? out.failedFormats.filter((f): f is string => typeof f === "string") : []
            if (failed.length > 0) console.log(`Could not render: ${failed.join(", ")}`)
          }
          if (opts.review) console.log(pc.dim(`  render every format after your review: nodaro edit continue-use-case ${result.jobId} --mode render-final`))
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── clip-pack (podcast use-case node) ──────────────────────────────────
  const isWhole = (v: string | undefined, min: number, max: number): boolean =>
    v !== undefined && /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max
  cmd
    .command("clip-pack")
    .description("cut a recording into a pack of short clips in one step (find the best moments, render each — framed and captioned by default)")
    .requiredOption("--media <url>", "the recording (video or audio URL, up to 3 hours; an audio recording makes audio clips)")
    .option("--count <n>", `how many clips, 1–${EDIT_PLAN_MAX_CLIP_COUNT} (default 8; the plan may find fewer)`)
    .option("--length <sec>", `each clip's target length in seconds, ${CLIP_PACK_MIN_TARGET_SEC}–${CLIP_PACK_MAX_TARGET_SEC} (default 60)`)
    .option("--framing <aspect>", `frame each clip on its speakers: ${EDL_TARGET_ASPECTS.join(" | ")}, or none for the recording's shape (default 9:16)`)
    .option("--layout <layout>", `layout with --framing <aspect> (default stacked): ${framingLayouts.join(" | ")}`)
    .option("--switch <id>", `the switch at each speaker change, with --framing <aspect> (default pan): cut | pan | zoom | xfade:<transition>, e.g. xfade:fade`)
    .option("--emphasis <style>", `how the speaker talking is emphasised, with --framing <aspect> (default scale): ${EMPHASIS_HELP}`)
    .option("--no-captions", "no captions on the clips")
    .option("--caption-style <style>", `the captions' look (default karaoke): ${ALL_CAPTION_STYLES.join(" | ")}`)
    .option("--review", "stop at previews to review (render the kept clips with `nodaro edit continue-use-case <jobId> --mode render-final`)")
    .option("--plan-tier <tier>", EDIT_PLAN_TIERS.join(" | "))
    .option("--instructions <text>", "instructions for picking the clips")
    .option("--style-guide <text>", "a style guide for the plan")
    .option("--idempotency-key <key>", "sent as Idempotency-Key: a retry with the same key answers the run already started")
    .option("--watch", "poll the job until it finishes, then print each clip's URL")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: GlobalOpts & WatchOpts & { media: string; count?: string; length?: string; framing?: string; layout?: string; switch?: string; emphasis?: string } & {
          captions: boolean; captionStyle?: string; review?: boolean; planTier?: string; instructions?: string; styleGuide?: string; idempotencyKey?: string
        },
      ) => {
        if (opts.count !== undefined && !isWhole(opts.count, 1, EDIT_PLAN_MAX_CLIP_COUNT)) {
          warn(`--count must be 1–${EDIT_PLAN_MAX_CLIP_COUNT} (got "${opts.count}")`)
          process.exit(1)
        }
        if (opts.length !== undefined && !isWhole(opts.length, CLIP_PACK_MIN_TARGET_SEC, CLIP_PACK_MAX_TARGET_SEC)) {
          warn(`--length must be ${CLIP_PACK_MIN_TARGET_SEC}–${CLIP_PACK_MAX_TARGET_SEC} seconds (got "${opts.length}")`)
          process.exit(1)
        }
        if (opts.framing !== undefined && opts.framing !== "none" && !(EDL_TARGET_ASPECTS as readonly string[]).includes(opts.framing)) {
          warn(`--framing must be ${EDL_TARGET_ASPECTS.join(", ")} or none (got "${opts.framing}")`)
          process.exit(1)
        }
        if (opts.layout !== undefined && (opts.framing === undefined || opts.framing === "none")) {
          warn("--layout applies with --framing <aspect> only (it picks the framed layout)")
          process.exit(1)
        }
        if (opts.layout !== undefined && !framingLayouts.includes(opts.layout)) {
          warn(`--layout must be ${framingLayouts.join(", ")} (got "${opts.layout}")`)
          process.exit(1)
        }
        for (const [flag, value] of [["--switch", opts.switch], ["--emphasis", opts.emphasis]] as const) {
          if (value !== undefined && (opts.framing === undefined || opts.framing === "none")) {
            warn(`${flag} applies with --framing <aspect> only (it is part of the framing)`)
            process.exit(1)
          }
        }
        if (opts.switch !== undefined && !SPEAKER_SWITCH_IDS.includes(opts.switch)) {
          warn(`--switch must be one of ${SPEAKER_SWITCH_IDS.join(", ")} (got "${opts.switch}")`)
          process.exit(1)
        }
        if (opts.emphasis !== undefined && !isKnownSpeakerEmphasisStyle(opts.emphasis)) {
          warn(`--emphasis must be ${EMPHASIS_HELP} (got "${opts.emphasis}")`)
          process.exit(1)
        }
        if (opts.captionStyle !== undefined && opts.captions === false) {
          warn("--caption-style applies with captions on (drop --no-captions)")
          process.exit(1)
        }
        if (opts.captionStyle !== undefined && !(ALL_CAPTION_STYLES as readonly string[]).includes(opts.captionStyle)) {
          warn(`--caption-style must be ${ALL_CAPTION_STYLES.join(", ")} (got "${opts.captionStyle}")`)
          process.exit(1)
        }
        refuseUnknownPlanTier(opts.planTier)
        type Framing = NonNullable<ClipPackInput["framing"]>
        try {
          const client = buildClient(opts.profile)
          const result = await client.edit.clipPack(
            {
              mediaUrl: opts.media,
              ...(opts.count !== undefined ? { count: Number(opts.count) } : {}),
              ...(opts.length !== undefined ? { targetDurationSec: Number(opts.length) } : {}),
              // none = the recording's shape; an aspect alone leaves the layout to the route (stacked).
              ...(opts.framing === "none"
                ? { framing: null }
                : opts.framing
                  ? {
                      framing: {
                        aspect: opts.framing as Framing["aspect"],
                        ...(opts.layout ? { layout: opts.layout as Framing["layout"] } : {}),
                        ...(opts.switch ? { switchType: opts.switch as Framing["switchType"] } : {}),
                        ...(opts.emphasis ? { emphasisStyle: opts.emphasis as Framing["emphasisStyle"] } : {}),
                      },
                    }
                  : {}),
              // commander's --no-captions defaults `captions` to true: send it only when turned off.
              ...(opts.captions === false ? { captions: false } : {}),
              ...(opts.captionStyle ? { captionStyle: opts.captionStyle as NonNullable<ClipPackInput["captionStyle"]> } : {}),
              ...(opts.review ? { reviewBeforeRender: true } : {}),
              ...(opts.planTier ? { planTier: opts.planTier as NonNullable<ClipPackInput["planTier"]> } : {}),
              ...(opts.instructions ? { instructions: opts.instructions } : {}),
              ...(opts.styleGuide ? { styleGuide: opts.styleGuide } : {}),
            },
            opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
          )
          const done = await reportQueuedJob(result, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: "clip-pack",
          })
          if (opts.json) return
          // The clips, one line each (its number, URL, title and "(no captions)" when its captions
          // failed), then how many could not be rendered; --json already printed the whole job.
          const out = done?.data.output_data as { clips?: unknown; failedClips?: unknown } | null | undefined
          if (done?.data.status === "completed" && Array.isArray(out?.clips)) {
            ;(out.clips as { url?: unknown; title?: unknown; captionsFailed?: unknown }[]).forEach((c, i) => {
              if (typeof c?.url !== "string") return
              const note = [typeof c.title === "string" ? c.title : "", c.captionsFailed === true ? "(no captions)" : ""].filter(Boolean).join(" ")
              console.log(`${i + 1}  ${c.url}${note ? `  ${note}` : ""}`)
            })
            const failed = typeof out.failedClips === "number" && out.failedClips > 0 ? out.failedClips : 0
            if (failed > 0) console.log(failed === 1 ? "1 clip could not be rendered." : `${failed} clips could not be rendered.`)
          }
          if (opts.review) console.log(pc.dim(`  render the kept clips after your review: nodaro edit continue-use-case ${result.jobId} --mode render-final [--edit <file>]`))
        } catch (err) {
          handleError(err)
        }
      },
    )

  // ── continue-use-case (podcast use-case runs) ───────────────────────────
  cmd
    .command("continue-use-case <jobId>")
    .description("continue a Tighten Episode, Chapters, Trailer or Clip Pack run as a new job: from where it failed, or its Render final after a review")
    .requiredOption("--mode <mode>", "from-failed | render-final")
    .option("--edit <file>", "render-final only: a JSON file holding the reviewer's edit of the plan (an EDL)")
    .option(
      "--type <type>",
      `the run's node type (${USE_CASE_NODE_TYPES.join(" | ")}); without it the job is read for its type, which needs the jobs:read scope`,
    )
    .option("--idempotency-key <key>", "sent as Idempotency-Key: a retry with the same key answers the run already started")
    .option("--watch", "poll the job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: GlobalOpts & WatchOpts & { mode: string; edit?: string; type?: string; idempotencyKey?: string }) => {
      if (opts.mode !== "from-failed" && opts.mode !== "render-final") {
        warn(`--mode must be "from-failed" or "render-final" (got "${opts.mode}")`)
        process.exit(1)
      }
      if (opts.type !== undefined && !(USE_CASE_NODE_TYPES as readonly string[]).includes(opts.type)) {
        warn(`--type must be ${USE_CASE_NODE_TYPES.join(", ")} (got "${opts.type}")`)
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
            ...(opts.type !== undefined ? { nodeType: opts.type as UseCaseNodeType } : {}),
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
        // The SDK could not read the run's type (no jobs:read, or no use-case type
        // recorded) and asks for `nodeType`: name this command's flag instead.
        if (err instanceof NodaroError && err.code === "use_case_type_unknown") {
          const message = "pass --type <node type> (this key can't read the job's type)"
          if (opts.json) {
            emit({ error: { code: err.code, message } }, opts)
          } else {
            console.error(pc.red(`✗ ${message}`))
            console.error(pc.dim(`  code: ${err.code}`))
            console.error(pc.dim(`  --type: ${USE_CASE_NODE_TYPES.join(" | ")}`))
          }
          process.exit(1)
        }
        handleError(err)
      }
    })
}
