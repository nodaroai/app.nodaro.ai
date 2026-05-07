import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, type OutputOpts } from "../output.js"
import { watchExecution } from "./workflows.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function executionsCommand(): Command {
  const cmd = new Command("executions").description("inspect and cancel workflow executions")

  cmd
    .command("get <id>")
    .description("show one execution by id (use --watch to follow until completion)")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll until terminal status (completed/failed/cancelled)")
    .action(async (id: string, opts: GlobalOpts & { watch?: boolean }) => {
      try {
        const client = buildClient(opts.profile)
        if (opts.watch) {
          await watchExecution(client, id, opts)
          return
        }
        const result = await client.executions.get(id)
        if (opts.json) emit(result.data, opts)
        else console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("cancel <id>")
    .description("cancel an active execution")
    .option("--profile <name>")
    .option("--json")
    .option("--mode <mode>", "cancellation mode: cancelled (immediate) or stopping (finish current level)", "cancelled")
    .action(async (id: string, opts: GlobalOpts & { mode?: "cancelled" | "stopping" }) => {
      try {
        const client = buildClient(opts.profile)
        const params = opts.mode ? { mode: opts.mode } : {}
        const result = await client.executions.cancel(id, params)
        if (opts.json) emit(result, opts)
        else success(`cancelled execution ${id} (mode: ${opts.mode ?? "cancelled"})`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
