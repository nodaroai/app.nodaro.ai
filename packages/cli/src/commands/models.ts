import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function modelsCommand(): Command {
  const cmd = new Command("models").description(
    "browse the model catalog — capability sheets, per-variant credit pricing, prompt tips",
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
                modes: m.modes.join(","),
                credits: (m.pricing ?? []).map((p) => p.credits).join("/") || "-",
                featured: m.featured ? "★" : "",
                doctrine: m.doctrineCovered ? "✓" : "",
              })),
            ),
          )
          table(rows, ["id", "kind", "family", "modes", "credits", "featured", "doctrine"])
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
