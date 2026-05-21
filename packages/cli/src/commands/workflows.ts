import { readFileSync, writeFileSync } from "node:fs"
import { Command } from "commander"
import type { WorkflowExport } from "@nodaro/shared"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, table, dim, type OutputOpts } from "../output.js"
import { watchUntilTerminal } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** Read a file and parse it as a JSON object. Throws a user-facing error on read/parse failure. */
function readJsonObject(path: string, flag: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${flag} ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${flag} ${path} is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${flag} ${path} must contain a JSON object at the top level`)
  }
  return parsed as Record<string, unknown>
}

export function workflowsCommand(): Command {
  const cmd = new Command("workflows").description("list, run, and manage workflows")

  cmd
    .command("list")
    .description("list workflows in a project")
    .requiredOption("--project <projectId>", "project id (run `nodaro projects list` to find it)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { project: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.list({ projectId: opts.project })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((w) => ({
            id: w.id,
            name: w.name,
            updatedAt: w.updatedAt,
          })),
          ["id", "name", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one workflow by id (includes nodes/edges)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.get(id)
        if (opts.json) emit(result.data, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a workflow in a project (optionally from an exported JSON bundle)")
    .requiredOption("--project <projectId>", "project id (run `nodaro projects list` to find it)")
    .requiredOption("--name <name>", "workflow name")
    .option("--file <jsonPath>", "path to a WorkflowExport JSON bundle to import as the new workflow")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { project: string; name: string; file?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        let result: { data: { id: string; name: string } }
        if (opts.file) {
          const bundle = readJsonObject(opts.file, "--file")
          result = await client.workflows.import({
            ...(bundle as unknown as WorkflowExport),
            name: opts.name,
            projectId: opts.project,
          })
        } else {
          result = await client.workflows.create({ projectId: opts.project, name: opts.name })
        }
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`created workflow ${result.data.id} (${result.data.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("update a workflow's name and/or its nodes/edges/settings from a JSON file")
    .option("--name <name>", "new workflow name")
    .option("--file <jsonPath>", "path to a JSON file with `nodes`/`edges`/`settings` to write")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { name?: string; file?: string } & GlobalOpts) => {
      try {
        if (opts.name === undefined && !opts.file) {
          throw new Error("nothing to update — pass --name and/or --file")
        }
        const client = buildClient(opts.profile)
        const body: Record<string, unknown> = {}
        if (opts.name !== undefined) body.name = opts.name
        if (opts.file) {
          const parsed = readJsonObject(opts.file, "--file")
          if (parsed.nodes !== undefined) body.nodes = parsed.nodes
          if (parsed.edges !== undefined) body.edges = parsed.edges
          if (parsed.settings !== undefined) body.settings = parsed.settings
        }
        const result = await client.workflows.update(id, body)
        if (opts.json) emit(result.data, opts)
        else success(`updated workflow ${result.data.id} (${result.data.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete a workflow")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.workflows.delete(id)
        if (opts.json) emit({ id, deleted: true }, opts)
        else success(`deleted workflow ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("export <id>")
    .description("export a workflow as a portable JSON bundle")
    .option("--with-assets", "include character/object/location entity data in the bundle")
    .option("--output <path>", "write the bundle to this file instead of stdout")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { withAssets?: boolean; output?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.export(id, { assets: opts.withAssets ?? false })
        if (opts.output) {
          writeFileSync(opts.output, JSON.stringify(result.data, null, 2) + "\n")
          success(`exported workflow ${id} → ${opts.output}`)
          return
        }
        // No --output: print the bundle to stdout (also covers --json).
        detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("import <file>")
    .description("import a WorkflowExport JSON bundle into a project")
    .requiredOption("--project <projectId>", "project id (run `nodaro projects list` to find it)")
    .option("--profile <name>")
    .option("--json")
    .action(async (file: string, opts: { project: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const bundle = readJsonObject(file, "<file>")
        const result = await client.workflows.import({
          ...(bundle as unknown as WorkflowExport),
          projectId: opts.project,
        })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`imported workflow ${result.data.id} (${result.data.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run <id>")
    .description("trigger a workflow run; prints execution id (use --watch to follow)")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll execution status until completion")
    .option("--node <ids...>", "execute only these node ids (space-separated)")
    .action(async (id: string, opts: GlobalOpts & { watch?: boolean; node?: string[] }) => {
      try {
        const client = buildClient(opts.profile)
        const params = opts.node ? { nodeIds: opts.node } : {}
        const result = await client.workflows.run(id, params)
        if (opts.json && !opts.watch) {
          emit(result, opts)
          return
        }
        success(`execution ${result.executionId} (${result.status})`)
        if (!opts.watch) {
          dim(`follow: nodaro executions get ${result.executionId} --watch`)
          return
        }
        await watchExecution(client, result.executionId, opts)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

export async function watchExecution(
  client: ReturnType<typeof buildClient>,
  executionId: string,
  opts: OutputOpts,
): Promise<void> {
  return watchUntilTerminal({
    fetch: () => client.executions.get(executionId),
    label: executionId,
    ...opts,
  })
}
