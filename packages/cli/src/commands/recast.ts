import { readFileSync } from "node:fs"
import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, warn, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

function readScript(path: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    throw new Error(`--file: cannot read ${path}`)
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--file: expected a JSON object (the authored script document)")
  }
  return parsed as Record<string, unknown>
}

export function recastCommand(): Command {
  const cmd = new Command("recast").description(
    "recast runs + authored-script import (movie as JSON) — Cloud edition",
  )

  cmd
    .command("skill")
    .description("print the authoring guide for writing a script (markdown, free)")
    .option("--profile <name>")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        process.stdout.write(await client.recast.authoringSkill())
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("validate")
    .description("validate an authored script JSON (free; loop until valid)")
    .requiredOption("--file <jsonPath>", "path to the authored script document")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { file: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.recast.validateScript(readScript(opts.file))
        if (opts.json) {
          emit(result, opts)
          return
        }
        if (result.valid) success("valid")
        else {
          warn(`invalid — ${result.errors.length} error(s)`)
          for (const e of result.errors) {
            console.log(`  ${e.path}: ${e.message}${e.hint ? `  (hint: ${e.hint})` : ""}`)
          }
        }
        for (const w of result.warnings) warn(w)
        if (!result.valid) process.exitCode = 1
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("import")
    .description("import a VALIDATED authored script as a completed analysis (free)")
    .requiredOption("--file <jsonPath>", "path to the authored script document")
    .option(
      "--rights-attested",
      "assert the script is your own work (required — authored recasts render Faithful, exactly as written)",
    )
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { file: string; rightsAttested?: boolean } & GlobalOpts) => {
      try {
        if (!opts.rightsAttested) {
          throw new Error(
            "authored imports require --rights-attested: confirm the script is your own work (it renders exactly as written)",
          )
        }
        const client = buildClient(opts.profile)
        const result = await client.recast.importScript(readScript(opts.file), {
          rightsAttested: true,
        })
        if (opts.json) emit(result, opts)
        else {
          success(`${result.created ? "imported" : "already imported"} — analysis job ${result.jobId}`)
          for (const w of result.warnings) warn(w)
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("estimate")
    .description("quote a run in credits before creating it")
    .requiredOption("--analysis-job <id>", "the source analysis job id")
    .option("--fidelity <f>", "render fidelity", "faithful")
    .option("--resolution <r>")
    .option("--segment-sec <n>", "segment length in seconds", parseFloat)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: { analysisJob: string; fidelity: string; resolution?: string; segmentSec?: number } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.recast.estimate({
            analysisJobId: opts.analysisJob,
            fidelity: opts.fidelity,
            resolution: opts.resolution,
            segmentSec: opts.segmentSec,
          })
          if (opts.json) emit(result, opts)
          else detail(result)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("create")
    .description("create a run — BUYS THE PLAN (credits); run `estimate` first")
    .requiredOption("--workflow <id>", "workflow the run attaches to")
    .requiredOption("--analysis-job <id>", "the source analysis job id")
    .option("--fidelity <f>", "render fidelity", "faithful")
    .option("--rights-attested", "required for faithful renders of authored scripts")
    .option("--resolution <r>")
    .option("--segment-sec <n>", "segment length in seconds", parseFloat)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: {
          workflow: string
          analysisJob: string
          fidelity: string
          rightsAttested?: boolean
          resolution?: string
          segmentSec?: number
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.recast.create({
            workflowId: opts.workflow,
            analysisJobId: opts.analysisJob,
            fidelity: opts.fidelity,
            rightsAttested: opts.rightsAttested,
            resolution: opts.resolution,
            segmentSec: opts.segmentSec,
          })
          if (opts.json) emit(result, opts)
          else success(`run ${result.recastId} created (planning) — poll: nodaro recast status ${result.recastId}`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("start <recastId>")
    .description("start rendering a planned run (idempotent)")
    .option("--segment-sec <n>", "segment length in seconds", parseFloat)
    .option("--profile <name>")
    .option("--json")
    .action(async (recastId: string, opts: { segmentSec?: number } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.recast.start(recastId, { segmentSec: opts.segmentSec })
        if (opts.json) emit(result, opts)
        else success(`rendering${result.gvpJobId ? ` — gvp job ${result.gvpJobId}` : ""}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("status <recastId>")
    .description("poll a run — status plus any pending interactive step")
    .option("--profile <name>")
    .option("--json")
    .action(async (recastId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.recast.get(recastId)
        if (opts.json) emit(result, opts)
        else detail(result)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
