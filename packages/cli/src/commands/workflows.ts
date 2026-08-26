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

  cmd
    .command("share <id>")
    .description("set a workflow's visibility: workspace (everyone in its workspace) or private (creator + named collaborators)")
    .option("--visibility <level>", "workspace | private", "workspace")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { visibility: string } & GlobalOpts) => {
      try {
        if (opts.visibility !== "workspace" && opts.visibility !== "private") {
          throw new Error("--visibility must be `workspace` or `private`")
        }
        const client = buildClient(opts.profile)
        const result = await client.workflows.setVisibility(id, opts.visibility)
        if (opts.json) emit(result.data, opts)
        else success(`workflow ${id} is now ${opts.visibility}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("move <id>")
    .description("move a workflow to another project")
    .requiredOption("--project <projectId>", "destination project id")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { project: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.move(id, { projectId: opts.project })
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`moved workflow ${id} → project ${opts.project}`)
        if (result.droppedCollaborators.length > 0) {
          dim(
            `${result.droppedCollaborators.length} collaborator grant(s) were dropped — they came from the workspace this workflow just left`,
          )
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("shared-with-me")
    .description("list workflows other people shared with you")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.sharedWithMe()
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((w) => ({ id: w.id, name: w.name, role: w.grantedRole, updatedAt: w.updatedAt })),
          ["id", "name", "role", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd.addCommand(collaboratorsCommand())

  return cmd
}

/** `nodaro workflows collaborators …` — the people a workflow is shared with. */
function collaboratorsCommand(): Command {
  const cmd = new Command("collaborators").description("manage who a workflow is shared with")

  cmd
    .command("list <id>")
    .description("list a workflow's collaborators")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.collaborators.list(id)
        if (opts.json) emit(result.data, opts)
        else table(result.data.map((c) => ({ userId: c.userId, name: c.name ?? "", role: c.role })), ["userId", "name", "role"])
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("add <id>")
    .description("share a workflow with a person by user id or email")
    .option("--user <userId>", "the collaborator's user id")
    .option("--email <email>", "the collaborator's email (any address; they need not have an account yet)")
    .requiredOption("--role <role>", "viewer | editor")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { user?: string; email?: string; role: string } & GlobalOpts) => {
      try {
        if ((opts.user === undefined) === (opts.email === undefined)) {
          throw new Error("provide exactly one of --user or --email")
        }
        if (opts.role !== "viewer" && opts.role !== "editor") {
          throw new Error("--role must be `viewer` or `editor`")
        }
        const client = buildClient(opts.profile)
        const result = await client.workflows.collaborators.add(id, {
          ...(opts.user ? { userId: opts.user } : { email: opts.email }),
          role: opts.role,
        })
        if (opts.json) emit(result.data, opts)
        else success(`shared workflow ${id} with ${opts.user ?? opts.email} as ${opts.role}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id> <userId>")
    .description("change a collaborator's role")
    .requiredOption("--role <role>", "viewer | editor")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, userId: string, opts: { role: string } & GlobalOpts) => {
      try {
        if (opts.role !== "viewer" && opts.role !== "editor") {
          throw new Error("--role must be `viewer` or `editor`")
        }
        const client = buildClient(opts.profile)
        const result = await client.workflows.collaborators.update(id, userId, { role: opts.role })
        if (opts.json) emit(result.data, opts)
        else success(`${userId} is now ${opts.role} on workflow ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("remove <id> <userId>")
    .description("remove a collaborator (or yourself)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, userId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.workflows.collaborators.remove(id, userId)
        if (opts.json) emit({ workflowId: id, userId, removed: true }, opts)
        else success(`removed ${userId} from workflow ${id}`)
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
  await watchUntilTerminal({
    fetch: () => client.executions.get(executionId),
    label: executionId,
    ...opts,
  })
}
