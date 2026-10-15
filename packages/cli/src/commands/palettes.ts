import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** Colours from one option value, comma- or space-separated. */
function colorList(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean)
}

export function palettesCommand(): Command {
  const cmd = new Command("palettes").description(
    "your colour palettes — use one on generate-image as direction.colorLook \"palette:<id>\"",
  )

  cmd
    .command("list")
    .description("your palettes, newest first")
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's nextCursor")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const page = await buildClient(opts.profile).palettes.list({
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((p) => ({ id: p.id, name: p.name, colors: p.colors.join(" "), updatedAt: p.updatedAt })),
          ["id", "name", "colors", "updatedAt"],
        )
        if (page.nextCursor) dim(`next: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one palette")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const palette = await buildClient(opts.profile).palettes.get(id)
        if (opts.json) emit(palette, opts)
        else detail(palette)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a palette (2-12 #RRGGBB colours)")
    .requiredOption("--name <name>", "1-80 characters")
    .requiredOption("--colors <hex...>", 'colours, comma- or space-separated, e.g. "#0F4C5C,#E3B23C"')
    .option("--description <text>", "your own note (not put into the prompt)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { name: string; colors: string[] | string; description?: string } & GlobalOpts) => {
      try {
        const palette = await buildClient(opts.profile).palettes.create({
          name: opts.name,
          colors: ([] as string[]).concat(opts.colors).flatMap(colorList),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
        })
        if (opts.json) {
          emit(palette, opts)
          return
        }
        success(`created palette ${palette.id} — use it as direction.colorLook "palette:${palette.id}"`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("change a palette: only what you pass is written")
    .option("--name <name>")
    .option("--colors <hex...>", "replace the colours (2-12, comma- or space-separated)")
    .option("--description <text>")
    .option("--clear-description", "remove the note")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: { name?: string; colors?: string[] | string; description?: string; clearDescription?: boolean } & GlobalOpts,
      ) => {
        try {
          const input = {
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.colors !== undefined ? { colors: ([] as string[]).concat(opts.colors).flatMap(colorList) } : {}),
            ...(opts.clearDescription ? { description: null } : opts.description !== undefined ? { description: opts.description } : {}),
          }
          if (Object.keys(input).length === 0) {
            throw new Error("nothing to update — provide --name, --colors, --description or --clear-description")
          }
          const palette = await buildClient(opts.profile).palettes.update(id, input)
          if (opts.json) {
            emit(palette, opts)
            return
          }
          success(`updated palette ${palette.id}`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("delete a palette (a run that still names it answers 404)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).palettes.delete(id)
        if (opts.json) {
          emit({ success: true, id }, opts)
          return
        }
        success(`deleted palette ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
