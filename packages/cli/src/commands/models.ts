import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import type { ModelCostsResult } from "@nodaro/sdk/credits"
import { emit, table, terminalSafe, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function modelsCommand(): Command {
  const cmd = new Command("models").description(
    "browse the model catalog — makers, capability sheets, per-variant credit pricing, prompt tips",
  )

  cmd
    .command("list")
    .description("list available models (grouped by kind and family)")
    .option("--kind <kind>", "image | video | audio")
    .option("--mode <mode>", 'operation filter, e.g. "t2v", "i2v", "t2i", "tts"')
    .option("--family <name>", 'vendor / lab name, e.g. "Google", "Bytedance"')
    .option("--featured", "featured models only")
    .option("--profile <name>")
    .option("--json")
    .addHelpText(
      "after",
      `
Examples:
  $ nodaro models list --kind video --mode i2v
  $ nodaro models list --family Google --json`,
    )
    .action(
      async (
        opts: { kind?: "image" | "video" | "audio"; mode?: string; family?: string; featured?: boolean } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.models.list({
            kind: opts.kind,
            mode: opts.mode,
            family: opts.family,
            featuredOnly: opts.featured,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          const rows = result.sections.flatMap((section) =>
            section.families.flatMap((group) =>
              group.models.map((m) => ({
                id: m.id,
                kind: section.kind,
                family: group.family,
                // The company behind the model (a family can name a lab or a
                // product line); an older server sends none.
                maker: m.maker?.name ?? "-",
                modes: m.modes.join(","),
                credits: (m.pricing ?? []).map((p) => p.credits).join("/") || "-",
                featured: m.featured ? "★" : "",
                doctrine: m.doctrineCovered ? "✓" : "",
              })),
            ),
          )
          table(rows, ["id", "kind", "family", "maker", "modes", "credits", "featured", "doctrine"])
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("cost <ids...>")
    .description(
      "credits each identifier is charged — a model id, a credit id, or a metered LLM price key (<feature>:<model>[:direct]); an estimate prints as ~N",
    )
    .option("--profile <name>")
    .option("--json")
    .addHelpText(
      "after",
      `
A metered LLM price key (llmPriceKey from @nodaro/shared/llm-models) is
charged for the tokens the call actually uses, so its figure is an estimate of
a typical call and prints as ~N. Every model's per-token rate:
docs/pricing/llm-models.md.

Examples:
  $ nodaro models cost nano-banana-pro seedance-2-fast
  $ nodaro models cost llm-chat:gemini-3.6-flash llm-chat:claude-opus-5.5:direct
  $ nodaro models cost llm-chat:claude-fable-5 --json`,
    )
    .action(async (ids: string[], opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.credits.modelCosts(ids)
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(costRows(ids, result), ["id", "credits", "note"])
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

/**
 * One row per asked identifier, in the order asked: `~N` for an estimate (a
 * metered LLM price key), `N` for a fixed price, `-` with the reason when the
 * server priced nothing for it.
 */
export function costRows(ids: string[], result: ModelCostsResult): Array<Record<string, string>> {
  const estimates = new Set(result.estimates ?? [])
  const missing = new Set(result.missing)
  const errors = new Set(result.errors)
  return [...new Set(ids)].map((id) => {
    const credits = result.data[id]
    if (typeof credits === "number") {
      const estimate = estimates.has(id)
      return { id, credits: estimate ? `~${credits}` : String(credits), note: estimate ? "estimate: charged per token used" : "" }
    }
    if (errors.has(id)) return { id, credits: "-", note: terminalSafe(result.errorCodes?.[id]?.message ?? "could not be priced") }
    if (missing.has(id)) return { id, credits: "-", note: "no price on this server" }
    return { id, credits: "-", note: "not asked (over the batch limit)" }
  })
}
