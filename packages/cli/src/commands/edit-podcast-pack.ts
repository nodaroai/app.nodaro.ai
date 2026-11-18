// `nodaro edit podcast-pack` (decided 2026-11-18): several podcast tools on
// one recording, for one price by its length. Registered on the `edit` command
// by edit.ts, after the use-case commands. The recording flags are theirs
// (edit-recordings.ts); each tool's settings are the JSON its own route takes.
import type { Command } from "commander"
import { PODCAST_PACK_TOOLS, type PodcastPackInput, type PodcastPackTool, type PodcastPackTools } from "@nodaro/sdk/edit"
import { buildClient, handleError } from "../client.js"
import { dim, emit, success, terminalSafe, warn } from "../output.js"
import { collectVariadic } from "../util.js"
import { readJsonFile, type GlobalOpts } from "./edit-shared.js"
import { lengthOf, reportPodcastPackEstimate } from "./edit-estimate.js"
import { recordingsInput, withRecordingsOptions, type RecordingsOpts } from "./edit-recordings.js"

/** The fields that belong to the pack, never to one tool's settings. */
const PACK_FIELDS = ["mediaUrl", "mediaUrls", "masterAudioUrl", "cameras", "speakerNames"] as const

const isTool = (name: string): name is PodcastPackTool => (PODCAST_PACK_TOOLS as readonly string[]).includes(name)

function refuse(message: string): never {
  warn(message)
  process.exit(1)
}

/** A tool's settings from `--tool <tool>=<json or file>`, or exit 1 before any request. */
function settingsOf(tool: PodcastPackTool, raw: string): Record<string, unknown> {
  const text = raw.trim()
  let value: unknown
  try {
    value = text.startsWith("{") ? JSON.parse(text) : readJsonFile(text)
  } catch (err) {
    refuse(`--tool ${tool}: the settings are not a JSON object (${(err as Error).message})`)
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse(`--tool ${tool}: the settings must be a JSON object`)
  const settings = value as Record<string, unknown>
  const packField = PACK_FIELDS.find((field) => field in settings)
  if (packField) refuse(`--tool ${tool}: ${packField} belongs to the pack — pass the recording with --media (and --master-audio, the Cameras flags, --speaker-names)`)
  return settings
}

/** The pack's tools from every `--tool` value (a comma list of tools, or one tool with its settings), or exit 1. */
export function packTools(values: readonly string[]): PodcastPackTools {
  const chosen = values.flatMap((value): Array<[PodcastPackTool, Record<string, unknown>]> => {
    const eq = value.indexOf("=")
    if (eq !== -1 && value.slice(0, eq).includes(",")) refuse(`--tool <tool>=<settings> names one tool: give each tool with settings its own --tool (got "${value.slice(0, eq)}")`)
    const names = eq === -1 ? value.split(",").map((n) => n.trim()).filter((n) => n.length > 0) : [value.slice(0, eq).trim()]
    for (const name of names) if (!isTool(name)) refuse(`--tool must be ${PODCAST_PACK_TOOLS.join(", ")} (got "${name}")`)
    const tools = names as PodcastPackTool[]
    return eq === -1 ? tools.map((tool) => [tool, {}]) : [[tools[0]!, settingsOf(tools[0]!, value.slice(eq + 1))]]
  })
  if (chosen.length === 0) refuse(`--tool names no tool: choose at least one of ${PODCAST_PACK_TOOLS.join(", ")}`)
  const twice = chosen.find(([tool], i) => chosen.findIndex(([other]) => other === tool) !== i)
  if (twice) refuse(`--tool names ${twice[0]} twice`)
  return Object.fromEntries(chosen) as PodcastPackTools
}

/** Adds `podcast-pack` to `cmd` (the `edit` command). */
export function registerPodcastPackCommand(cmd: Command): void {
  withRecordingsOptions(
    cmd
      .command("podcast-pack")
      .description("run several podcast tools on one recording for one price by its length (each tool its own run and job)"),
  )
    .requiredOption(
      "--tool <tool[=settings]>",
      `a tool to run: ${PODCAST_PACK_TOOLS.join(" | ")} (repeat it, or comma-separate tools that take their defaults); <tool>=<json> or <tool>=<file.json> gives it its own settings, as its own command's route takes them`,
      collectVariadic,
    )
    .option("--speaker-names <file>", "JSON object: speaker label → name to show (passed to the tools that take it)")
    .option("--idempotency-key <key>", "sent as Idempotency-Key: a retry with the same key answers the pack already started")
    .option("--estimate", "quote the pack only: what these flags would be charged, with nothing created or charged (--idempotency-key is not used)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts & RecordingsOpts & { tool: string[]; speakerNames?: string; idempotencyKey?: string; estimate?: boolean }) => {
      const tools = packTools(opts.tool)
      const recordings = recordingsInput(opts)
      try {
        const speakerNames = opts.speakerNames !== undefined ? (readJsonFile(opts.speakerNames) as Record<string, string>) : undefined
        const input: PodcastPackInput = { ...recordings, ...(speakerNames !== undefined ? { speakerNames } : {}), tools }
        const client = buildClient(opts.profile)
        if (opts.estimate) return reportPodcastPackEstimate((await client.edit.estimatePodcastPack(input)).data, opts)
        const result = await client.edit.podcastPack(input, opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined)
        if (opts.json) return emit(result, opts)
        if (result.deduped) {
          success(`podcast pack ${result.jobId} was already started with this key`)
          dim(`its tools: nodaro jobs get ${result.jobId} (output_data.tools)`)
          return
        }
        success(`podcast pack ${result.jobId} started (${result.units === 1 ? "1 unit" : `${result.units} units`}; the recording is ${lengthOf(result.durationSec)})`)
        // Each tool's job, then the tools that did not start; the pack keeps its charge for the ones that did.
        for (const run of result.tools) console.log(`${run.tool}  ${run.jobId}`)
        for (const skipped of result.notStarted ?? []) {
          console.log(`${skipped.tool}  did not start: ${terminalSafe(skipped.error.message)} (${terminalSafe(skipped.error.code)})`)
        }
        dim("follow each tool: nodaro jobs get <jobId>; one that fails continues free: nodaro edit continue-use-case <jobId> --mode from-failed")
        if ((result.notStarted ?? []).length > 0) dim(`a tool that did not start starts free, once: nodaro edit podcast-pack-start ${result.jobId} <tool>`)
      } catch (err) {
        handleError(err)
      }
    })
}

/** `edit podcast-pack-start <packJobId> <tool>`: start, free and once, a tool a pack paid for that did not start. */
export function registerPodcastPackStartCommand(cmd: Command): void {
  cmd
    .command("podcast-pack-start")
    .description("start, free and once per tool, a tool a podcast pack paid for that did not start (the pack's notStarted)")
    .argument("<packJobId>", "the pack's job id (what edit podcast-pack printed first)")
    .argument("<tool>", `the tool to start: ${PODCAST_PACK_TOOLS.join(" | ")}`)
    .option("--profile <name>")
    .option("--json")
    .action(async (packJobId: string, tool: string, opts: GlobalOpts) => {
      if (!(PODCAST_PACK_TOOLS as readonly string[]).includes(tool)) {
        warn(`unknown tool "${terminalSafe(tool)}": one of ${PODCAST_PACK_TOOLS.join(", ")}`)
        process.exit(1)
      }
      try {
        const result = await buildClient(opts.profile).edit.startPodcastPackTool(packJobId, tool as PodcastPackTool)
        if (opts.json) return emit(result, opts)
        success(`${result.tool} started under its pack: ${result.jobId}`)
        dim("follow it: nodaro jobs get <jobId>; if it fails it continues free: nodaro edit continue-use-case <jobId> --mode from-failed")
      } catch (err) {
        handleError(err)
      }
    })
}
