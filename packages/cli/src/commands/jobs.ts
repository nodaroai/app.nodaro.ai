import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function jobsCommand(): Command {
  const cmd = new Command("jobs").description("inspect and cancel individual jobs")

  cmd
    .command("get <id>")
    .description("show one job by id")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.jobs.get(id)
        if (opts.json) emit(result.data, opts)
        else console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("cancel <id>")
    .description("cancel a pending or running job")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.jobs.cancel(id)
        if (opts.json) emit(result, opts)
        else success(`cancelled job ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
