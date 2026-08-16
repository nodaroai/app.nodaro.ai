import { readFileSync } from "node:fs"
import { Command } from "commander"
import type { CreateShotInput, UpdateShotInput } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** Parse `--file` JSON into a plain object, with a flag-specific error. */
function readJsonObject(path: string, flag: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    throw new Error(`${flag}: cannot read ${path}`)
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${flag}: expected a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function shotsCommand(): Command {
  const cmd = new Command("shots").description(
    "Cine share → remix records — create, inspect, toggle visibility, delete",
  )

  cmd
    .command("get <id>")
    .description("read a shot (public shots resolve for anyone holding the id)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.shots.get(id)
        if (opts.json) emit(result.shot, opts)
        else detail(result.shot)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a shot record from a JSON file (CreateShotInput shape)")
    .option("--file <jsonPath>", "path to a JSON file with the shot fields")
    .option("--visibility <v>", "private | public (default private)")
    .option("--profile <name>")
    .option("--json")
    .addHelpText(
      "after",
      `
Examples:
  $ nodaro shots create --file shot.json
  $ nodaro shots create --file shot.json --visibility public`,
    )
    .action(async (opts: { file?: string; visibility?: string } & GlobalOpts) => {
      try {
        const input = opts.file ? readJsonObject(opts.file, "--file") : {}
        if (opts.visibility) input.visibility = opts.visibility
        const client = buildClient(opts.profile)
        const result = await client.shots.create(input as CreateShotInput)
        if (opts.json) emit(result, opts)
        else success(`created shot ${result.id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("update an owned shot (any subset of fields, e.g. a visibility toggle)")
    .option("--file <jsonPath>", "path to a JSON file with the fields to change")
    .option("--visibility <v>", "private | public")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { file?: string; visibility?: string } & GlobalOpts) => {
      try {
        const input = opts.file ? readJsonObject(opts.file, "--file") : {}
        if (opts.visibility) input.visibility = opts.visibility
        if (Object.keys(input).length === 0) {
          throw new Error("nothing to update — pass --visibility and/or --file")
        }
        const client = buildClient(opts.profile)
        const result = await client.shots.update(id, input as UpdateShotInput)
        if (opts.json) emit(result.shot, opts)
        else detail(result.shot)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete an owned shot")
    .option("--profile <name>")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.shots.delete(id)
        success(`deleted shot ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
