import { writeFileSync } from "node:fs"
import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function presetsCommand(): Command {
  const cmd = new Command("presets").description(
    "list saved node presets — your custom presets plus the built-in factory catalog",
  )

  cmd
    .command("list")
    .description("list your custom presets (or the built-in factory catalog with --factory)")
    .option("--node-type <type>", "filter to one node type, e.g. generate-image")
    .option("--factory", "list the built-in factory catalog instead of your custom presets")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { nodeType?: string; factory?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        if (opts.factory) {
          if (!opts.nodeType) {
            handleError(new Error("--node-type is required with --factory (e.g. --node-type generate-image)"))
            return
          }
          const result = await client.presets.listFactory(opts.nodeType)
          if (opts.json) {
            emit(result, opts)
            return
          }
          table(
            result.data.map((p) => ({
              id: p.id,
              name: p.name,
              group: p.group ?? "",
            })),
            ["id", "name", "group"],
          )
          return
        }
        const presets = await client.presets.list(opts.nodeType)
        if (opts.json) {
          emit(presets, opts)
          return
        }
        table(
          presets.map((p) => ({ id: p.id, nodeType: p.nodeType, name: p.name, updatedAt: p.updatedAt })),
          ["id", "nodeType", "name", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("groups")
    .description("list your preset folders and sections")
    .option("--node-type <type>", "filter to one node type")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { nodeType?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const groups = await client.presets.listGroups(opts.nodeType)
        if (opts.json) {
          emit(groups, opts)
          return
        }
        table(
          groups.map((g) => ({ id: g.id, nodeType: g.nodeType, name: g.name, kind: g.kind })),
          ["id", "nodeType", "name", "kind"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("export")
    .description("export your custom presets as an import-compatible JSON envelope (stdout, or --output file)")
    .option("--node-type <type>", "filter to one node type")
    .option("--output <file>", "write to a file instead of stdout")
    .option("--profile <name>")
    .action(async (opts: { nodeType?: string; output?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const presets = await client.presets.list(opts.nodeType)
        const envelope = {
          kind: "nodaro.node-presets",
          version: 1,
          exportedAt: new Date().toISOString(),
          presets: presets.map((p) => ({
            nodeType: p.nodeType,
            name: p.name,
            description: p.description,
            data: p.data,
          })),
        }
        const json = JSON.stringify(envelope, null, 2)
        if (opts.output) {
          writeFileSync(opts.output, json)
          success(`exported ${presets.length} preset${presets.length === 1 ? "" : "s"} to ${opts.output}`)
        } else {
          process.stdout.write(`${json}\n`)
        }
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
