import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, warn, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function projectsCommand(): Command {
  const cmd = new Command("projects").description("list, inspect, and manage projects")

  cmd
    .command("list")
    .description("list all projects accessible to the current token")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.projects.list()
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt,
          })),
          ["id", "name", "createdAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one project by id")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.projects.get(id)
        if (opts.json) emit(result.data, opts)
        else console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a new project")
    .requiredOption("--name <name>", "project name")
    .option("--description <desc>", "project description")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { name: string; description?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.projects.create({
          name: opts.name,
          description: opts.description,
        })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`created project ${result.data.id}`)
        console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("update a project's name and/or description")
    .option("--name <name>", "new project name")
    .option("--description <desc>", "new project description")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { name?: string; description?: string } & GlobalOpts) => {
      try {
        if (opts.name === undefined && opts.description === undefined) {
          warn("nothing to update — provide --name and/or --description")
          process.exit(1)
        }
        const client = buildClient(opts.profile)
        const result = await client.projects.update(id, {
          name: opts.name,
          description: opts.description,
        })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`updated project ${result.data.id}`)
        console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete a project")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.projects.delete(id)
        if (opts.json) {
          emit({ success: true, id }, opts)
          return
        }
        success(`Deleted project ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
