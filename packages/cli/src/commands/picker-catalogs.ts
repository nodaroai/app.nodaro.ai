import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, emit, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function pickerCatalogsCommand(): Command {
  const cmd = new Command("pickers").description(
    "list parameter-picker node types and their value catalogs (valid ids for setting, mood, person, …)",
  )

  cmd
    .command("list")
    .description("list all picker node types + option counts")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.pickerCatalogs.list()
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((c) => ({
            nodeType: c.nodeType,
            label: c.label,
            kind: c.kind,
            field: c.valueField ?? (c.fields?.join("+") ?? ""),
            options: c.optionCount,
          })),
          ["nodeType", "label", "kind", "field", "options"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("analyze <text>")
    .description("AI Fill: choose picker values from a free-text description (credit-billed LLM call)")
    .option("--target <types>", "comma-separated picker node types to fill (default: all analyzable)")
    .option("--instructions <text>", "extra guidance for the analyzer")
    .option("--model <id>", "LLM model override")
    .option("--effort <level>", "reasoning effort override")
    .option("--profile <name>")
    .option("--json")
    .addHelpText(
      "after",
      `
Examples:
  $ nodaro pickers analyze "rainy neon alley at night, low tracking shot"
  $ nodaro pickers analyze "sunlit kitchen, warm morning" --target setting,mood`,
    )
    .action(
      async (
        text: string,
        opts: { target?: string; instructions?: string; model?: string; effort?: string } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.pickerCatalogs.analyzeText({
            text,
            targetPickers: opts.target?.split(",").map((t) => t.trim()).filter(Boolean),
            instructions: opts.instructions,
            origin: "cli",
            llmModel: opts.model,
            reasoningEffort: opts.effort,
          })
          if (opts.json) emit(result, opts)
          else detail(result.pickerJson)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("get <nodeType>")
    .description("show one picker's catalog of valid values")
    .option("--full", "include description + the prompt fragment each id injects")
    .option("--category <name>", "single-dim pickers: filter to one category")
    .option("--field <name>", "multi-dim pickers (person/styling/framing): only this dimension")
    .option("--profile <name>")
    .option("--json")
    .addHelpText(
      "after",
      `
Examples:
  $ nodaro pickers list
  $ nodaro pickers get setting
  $ nodaro pickers get setting --full --category Urban
  $ nodaro pickers get person --field hairColor`,
    )
    .action(
      async (
        nodeType: string,
        opts: { full?: boolean; category?: string; field?: string } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.pickerCatalogs.get(nodeType, {
            detail: opts.full ? "full" : "compact",
            category: opts.category,
            field: opts.field,
          })
          if (opts.json) emit(result.data, opts)
          else detail(result.data)
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
