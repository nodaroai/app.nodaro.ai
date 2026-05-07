import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function projectsCommand(): Command {
  const cmd = new Command("projects").description("list and inspect projects")

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

  return cmd
}
