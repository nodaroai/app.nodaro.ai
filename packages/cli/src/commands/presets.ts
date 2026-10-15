import { readFileSync, writeFileSync } from "node:fs"
import { Command } from "commander"
import { parseNodePresetExport } from "@nodaro/shared/nodes"
import type { ImportNodePresetInput, UpdateNodePresetInput } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** Repeatable `--tag` values. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

function readJsonFile(path: string): unknown {
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

/** A preset's `data` from `--data <json>` or `--data-file <path>`; undefined when neither is given. */
function presetData(opts: { data?: string; dataFile?: string }): Record<string, unknown> | undefined {
  if (opts.data !== undefined && opts.dataFile !== undefined) throw new Error("pass --data or --data-file, not both")
  let value: unknown
  if (opts.data !== undefined) {
    try {
      value = JSON.parse(opts.data)
    } catch (err) {
      throw new Error(`--data is not valid JSON: ${(err as Error).message}`)
    }
  } else if (opts.dataFile !== undefined) {
    value = readJsonFile(opts.dataFile)
  } else {
    return undefined
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("the preset data must be a JSON object")
  return value as Record<string, unknown>
}

/**
 * The presets to import from a file: the envelope `nodaro presets export`
 * writes (validated, runtime keys stripped), or a bare list of
 * `{ nodeType, name, description?, data, previewUrl? }` (checked by the server).
 */
function presetsToImport(value: unknown): ImportNodePresetInput[] {
  if (Array.isArray(value)) return value as ImportNodePresetInput[]
  return parseNodePresetExport(value).presets
}

/** A whole number from the command line, refused by name rather than sent as NaN. */
function intOption(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined
  if (!/^-?\d+$/.test(raw.trim())) throw new Error(`${flag} must be a whole number`)
  return Number(raw)
}

function groupKind(raw: string | undefined): "folder" | "section" | undefined {
  if (raw === undefined) return undefined
  if (raw !== "folder" && raw !== "section") throw new Error("--kind must be folder or section")
  return raw
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`

export function presetsCommand(): Command {
  const cmd = new Command("presets").description(
    "node presets — your own (create, update, delete, import, favorites, folders) plus the built-in factory catalog",
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
              photos: p.minReferences ? p.minReferences : "",
              preview: p.previewUrl ? "yes" : "",
            })),
            ["id", "name", "group", "photos", "preview"],
          )
          return
        }
        const presets = await client.presets.list(opts.nodeType)
        if (opts.json) {
          emit(presets, opts)
          return
        }
        table(
          presets.map((p) => ({
            id: p.id,
            nodeType: p.nodeType,
            name: p.name,
            photos: p.minReferences ? p.minReferences : "",
            updatedAt: p.updatedAt,
          })),
          ["id", "nodeType", "name", "photos", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("save a preset: a node type, a name and its node config (data)")
    .requiredOption("--node-type <type>", "the node type it configures, e.g. generate-image")
    .requiredOption("--name <name>", "unique per node type")
    .option("--data <json>", "the node config as a JSON object")
    .option("--data-file <path>", "the node config from a JSON file (- for stdin)")
    .option("--description <text>")
    .option("--group <id>", "one of your preset folders")
    .option("--tag <tag>", "a tag (repeatable)", collect)
    .option("--preview-url <url>", "an example picture: an image already stored on this platform")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: {
          nodeType: string
          name: string
          data?: string
          dataFile?: string
          description?: string
          group?: string
          tag?: string[]
          previewUrl?: string
        } & GlobalOpts,
      ) => {
        try {
          const data = presetData(opts)
          if (!data) throw new Error("pass the preset's node config with --data or --data-file")
          const preset = await buildClient(opts.profile).presets.create({
            nodeType: opts.nodeType,
            name: opts.name,
            data,
            ...(opts.description !== undefined ? { description: opts.description } : {}),
            ...(opts.group !== undefined ? { groupId: opts.group } : {}),
            ...(opts.tag !== undefined ? { tags: opts.tag } : {}),
            ...(opts.previewUrl !== undefined ? { previewUrl: opts.previewUrl } : {}),
          })
          if (opts.json) {
            emit(preset, opts)
            return
          }
          success(`created preset ${preset.name} (${preset.id})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("update <id>")
    .description("rename a preset, replace its config, move it, or set / remove its preview")
    .option("--name <name>")
    .option("--description <text>")
    .option("--data <json>", "replace the node config with this JSON object")
    .option("--data-file <path>", "replace the node config from a JSON file (- for stdin)")
    .option("--group <id>", "move it into one of your preset folders")
    .option("--no-group", "move it out of its folder")
    .option("--tag <tag>", "replace the tags (repeatable)", collect)
    .option("--preview-url <url>", "set the example picture: an image already stored on this platform")
    .option("--no-preview-url", "remove the example picture")
    .option("--expected-updated-at <iso>", "refuse if the preset changed since this updatedAt")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: {
          name?: string
          description?: string
          data?: string
          dataFile?: string
          group?: string | false
          tag?: string[]
          previewUrl?: string | false
          expectedUpdatedAt?: string
        } & GlobalOpts,
      ) => {
        try {
          const data = presetData(opts)
          const patch: UpdateNodePresetInput = {
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.description !== undefined ? { description: opts.description } : {}),
            ...(data !== undefined ? { data } : {}),
            ...(opts.group !== undefined ? { groupId: opts.group === false ? null : opts.group } : {}),
            ...(opts.tag !== undefined ? { tags: opts.tag } : {}),
            ...(opts.previewUrl !== undefined ? { previewUrl: opts.previewUrl === false ? null : opts.previewUrl } : {}),
          }
          if (Object.keys(patch).length === 0) {
            throw new Error("nothing to update — pass --name, --description, --data, --group, --tag or --preview-url")
          }
          const preset = await buildClient(opts.profile).presets.update(
            id,
            patch,
            opts.expectedUpdatedAt ? { expectedUpdatedAt: opts.expectedUpdatedAt } : {},
          )
          if (opts.json) {
            emit(preset, opts)
            return
          }
          success(`updated preset ${preset.name} (${preset.id})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("delete one of your presets")
    .option("--expected-updated-at <iso>", "refuse if the preset changed since this updatedAt")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { expectedUpdatedAt?: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).presets.delete(
          id,
          opts.expectedUpdatedAt ? { expectedUpdatedAt: opts.expectedUpdatedAt } : {},
        )
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`deleted preset ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("import <file>")
    .description("import presets from a file: what `presets export` writes, or a JSON list of presets (- for stdin)")
    .option("--profile <name>")
    .option("--json")
    .action(async (path: string, opts: GlobalOpts) => {
      try {
        const presets = presetsToImport(readJsonFile(path))
        const result = await buildClient(opts.profile).presets.import(presets)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`imported ${plural(result.imported, "preset")}`)
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
          success(`exported ${plural(presets.length, "preset")} to ${opts.output}`)
        } else {
          process.stdout.write(`${json}\n`)
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorites")
    .description("list your favorite preset ids for a node type, newest first")
    .requiredOption("--node-type <type>", "e.g. generate-image")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { nodeType: string } & GlobalOpts) => {
      try {
        const ids = await buildClient(opts.profile).presets.favorites(opts.nodeType)
        if (opts.json) {
          emit(ids, opts)
          return
        }
        table(ids.map((presetId) => ({ presetId })), ["presetId"])
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorite <presetId>")
    .description("add a preset (a factory id such as generate-image/character-board, or one of yours) to your favorites")
    .requiredOption("--node-type <type>", "e.g. generate-image")
    .option("--profile <name>")
    .option("--json")
    .action(async (presetId: string, opts: { nodeType: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).presets.addFavorite({ nodeType: opts.nodeType, presetId })
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`added ${presetId} to your favorites`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("unfavorite <presetId>")
    .description("remove a preset from your favorites")
    .requiredOption("--node-type <type>", "e.g. generate-image")
    .option("--profile <name>")
    .option("--json")
    .action(async (presetId: string, opts: { nodeType: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).presets.removeFavorite({ nodeType: opts.nodeType, presetId })
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`removed ${presetId} from your favorites`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd.addCommand(groupsCommand())

  return cmd
}

/** `nodaro presets groups …` — your preset folders and sections. Bare `groups` lists them. */
function groupsCommand(): Command {
  const cmd = new Command("groups").description("your preset folders and sections: list (default), create, update, delete")

  cmd
    .command("list", { isDefault: true })
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
    .command("create")
    .description("create a folder (collapsible) or a section (a flat header)")
    .requiredOption("--node-type <type>", "e.g. generate-image")
    .requiredOption("--name <name>")
    .option("--kind <kind>", "folder (default) or section")
    .option("--sort-order <n>", "its position")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { nodeType: string; name: string; kind?: string; sortOrder?: string } & GlobalOpts) => {
      try {
        const kind = groupKind(opts.kind)
        const sortOrder = intOption(opts.sortOrder, "--sort-order")
        const group = await buildClient(opts.profile).presets.createGroup({
          nodeType: opts.nodeType,
          name: opts.name,
          ...(kind !== undefined ? { kind } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
        })
        if (opts.json) {
          emit(group, opts)
          return
        }
        success(`created ${group.kind} ${group.name} (${group.id})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("rename or move a folder or section")
    .option("--name <name>")
    .option("--sort-order <n>", "its position")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { name?: string; sortOrder?: string } & GlobalOpts) => {
      try {
        const sortOrder = intOption(opts.sortOrder, "--sort-order")
        if (opts.name === undefined && sortOrder === undefined) throw new Error("nothing to update — pass --name or --sort-order")
        const group = await buildClient(opts.profile).presets.updateGroup(id, {
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
        })
        if (opts.json) {
          emit(group, opts)
          return
        }
        success(`updated ${group.kind} ${group.name} (${group.id})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete a folder or section — its presets move out of it, none are deleted")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).presets.deleteGroup(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`deleted preset group ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
