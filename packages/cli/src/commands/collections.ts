import { readFileSync, writeFileSync } from "node:fs"
import { Command } from "commander"
import { collectionRecordHeadline, type AddCollectionRecordInput, type CollectionExportFormat } from "@nodaro/shared"
import { buildClient, handleError } from "../client.js"
import { emit, info, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

function readJson(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path === "-" ? 0 : path, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
}

/** The item to save from a JSON file: one object, or a list of them with `index` choosing one. */
export function itemFromJson(value: unknown, index = 0): unknown {
  const candidate = Array.isArray(value) ? value[index] : value
  if (candidate === undefined || candidate === null) {
    throw new Error(Array.isArray(value) ? `the file has no item ${index}` : "the file holds nothing to save")
  }
  return candidate
}

export function parseFormat(raw: string | undefined): CollectionExportFormat {
  if (raw === undefined) return "csv"
  if (raw !== "csv" && raw !== "json") throw new Error("--format must be csv or json")
  return raw
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function collectionsCommand(): Command {
  const cmd = new Command("collections").description(
    "your collections: the records a workflow saves (Save to Collection) and reads back (Read Collection)",
  )

  cmd
    .command("list")
    .description("list your collections with their record counts")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.collections.list()
        if (opts.json) {
          emit(page, opts)
          return
        }
        if (!page.available) {
          info("collections are not available on this server yet")
          return
        }
        table(
          page.data.map((c) => ({ id: c.id, name: c.name, records: c.recordCount, description: shorten(c.description, 48), updated: c.updatedAt.slice(0, 10) })),
          ["id", "name", "records", "description", "updated"],
        )
        info(`caps: ${page.caps.collections ?? "unlimited"} collections, ${page.caps.records ?? "unlimited"} records each`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create <name>")
    .description("create a collection")
    .option("--description <text>", "what goes in it")
    .option("--profile <name>")
    .option("--json")
    .action(async (name: string, opts: { description?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const collection = await client.collections.create({ name, description: opts.description })
        if (opts.json) {
          emit(collection, opts)
          return
        }
        success(`created "${collection.name}" (id ${collection.id})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("show <id>")
    .description("one collection")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        emit(await client.collections.get(id), opts)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("rename or re-describe a collection")
    .option("--name <name>", "the new name")
    .option("--description <text>", "the new description; an empty string clears it")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { name?: string; description?: string } & GlobalOpts) => {
      try {
        if (opts.name === undefined && opts.description === undefined) {
          throw new Error("nothing to change: give --name or --description")
        }
        const client = buildClient(opts.profile)
        const collection = await client.collections.update(id, { name: opts.name, description: opts.description })
        if (opts.json) {
          emit(collection, opts)
          return
        }
        success(`updated ${collection.id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("remove a collection and every record in it")
    .option("--profile <name>")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.collections.delete(id)
        success(`deleted ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("records <id>")
    .description("a collection's records, newest first")
    .option("--q <words>", "words in the title, text or link")
    .option("--since <iso>", "only records saved at or after this time (ISO)")
    .option("--limit <n>", "page size, 1-100 (default 50)")
    .option("--cursor <cursor>", "the next cursor printed by the previous page")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { q?: string; since?: string; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.collections.records(id, {
          q: opts.q,
          since: opts.since,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((r) => ({ id: r.id, saved: r.createdAt.slice(0, 10), headline: shorten(collectionRecordHeadline(r), 56), url: r.url ?? "" })),
          ["id", "saved", "headline", "url"],
        )
        if (page.nextCursor) success(`more: --cursor "${page.nextCursor}"`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("add <id>")
    .description("save one record: give the fields, or --file with any JSON item (a post, a search result) to map")
    .option("--title <text>")
    .option("--text <text>")
    .option("--url <link>", "an http(s) link; the default dedupe key")
    .option("--file <path>", "an item as JSON (- reads stdin); a list with --index picks one")
    .option("--index <n>", "which item of a list to save (default 0)")
    .option("--dedupe-key <key>", "overrides the link as the dedupe key")
    .option("--idempotency-key <key>", "the same key twice saves once")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: { title?: string; text?: string; url?: string; file?: string; index?: string; dedupeKey?: string; idempotencyKey?: string } & GlobalOpts,
      ) => {
        try {
          const input: AddCollectionRecordInput = {
            title: opts.title,
            text: opts.text,
            url: opts.url,
            dedupeKey: opts.dedupeKey,
            ...(opts.file ? { item: itemFromJson(readJson(opts.file), opts.index ? Number(opts.index) : 0) } : {}),
          }
          if (!opts.file && opts.title === undefined && opts.text === undefined && opts.url === undefined) {
            throw new Error("nothing to save: give --title, --text, --url or --file")
          }
          const client = buildClient(opts.profile)
          const result = await client.collections.addRecord(id, input, { idempotencyKey: opts.idempotencyKey })
          if (opts.json) {
            emit(result, opts)
            return
          }
          if (result.outcome === "inserted") {
            success(`saved ${result.record.id}${result.evicted > 0 ? ` (${result.evicted} oldest evicted past the cap)` : ""}`)
          } else if (result.outcome === "duplicate") {
            info(`already there as ${result.record.id} (same link or key, saved ${result.record.createdAt.slice(0, 10)})`)
          } else {
            info(`already saved by this same write: ${result.record.id}`)
          }
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("remove <id> <recordId>")
    .description("remove one record")
    .option("--profile <name>")
    .action(async (id: string, recordId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.collections.deleteRecord(id, recordId)
        success(`removed ${recordId}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("export <id>")
    .description("the whole collection as CSV (default) or JSON, to stdout or a file")
    .option("--format <format>", "csv or json (default csv)")
    .option("--since <iso>", "only records saved at or after this time (ISO)")
    .option("--q <words>", "words in the title, text or link")
    .option("--out <path>", "write to this file instead of stdout")
    .option("--profile <name>")
    .action(async (id: string, opts: { format?: string; since?: string; q?: string; out?: string } & GlobalOpts) => {
      try {
        const format = parseFormat(opts.format)
        const client = buildClient(opts.profile)
        const body = await client.collections.export(id, { format, since: opts.since, q: opts.q })
        if (opts.out) {
          writeFileSync(opts.out, body, "utf8")
          success(`wrote ${opts.out}`)
          return
        }
        process.stdout.write(body)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
