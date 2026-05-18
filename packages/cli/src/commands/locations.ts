import { Command } from "commander"
import { LOCATION_ASSET_TYPES, LOCATION_ATTACH_COLUMNS } from "@nodaro/client"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, dim, type OutputOpts } from "../output.js"
import { watchUntilTerminal } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * Coerce the --count flag value into the union the SDK expects. Defaults to 1
 * on any other value; the SDK will further validate downstream.
 */
function parseCount(raw: string | undefined): 1 | 2 | 4 {
  if (raw === "2") return 2
  if (raw === "4") return 4
  return 1
}

/**
 * Asset-type → DB-column dispatch table. The user-facing asset-type names are
 * camelCase (`timeOfDay`, `atmosphereMotions`) while the DB columns are
 * snake_case (`time_of_day`, `atmosphere_motions`). Without this map,
 * `--asset-type timeOfDay` would round-trip as `attachToColumn: "timeOfDay"`
 * which isn't in the Zod enum the route enforces.
 *
 * `custom` has no mapping — callers must pass `--column` explicitly so the
 * worker knows which bucket to write to.
 */
const ASSET_TYPE_TO_COLUMN: Record<string, (typeof LOCATION_ATTACH_COLUMNS)[number]> = {
  timeOfDay: "time_of_day",
  weather: "weather",
  seasons: "seasons",
  angles: "angles",
  lighting: "lighting",
}

export function locationsCommand(): Command {
  const cmd = new Command("locations").description(
    "list, inspect, and manage locations; trigger main-image / asset generation",
  )

  cmd
    .command("list")
    .description("list locations (active by default)")
    .option("--archived", "show archived locations instead of active ones")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (opts: { archived?: boolean } & GlobalOpts) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.locations.list({ archived: opts.archived })
          if (opts.json) {
            emit(result.locations, opts)
            return
          }
          table(
            result.locations.map((l) => ({
              id: l.id,
              name: l.name,
              category: l.category ?? "",
              mainImage: l.sourceImageUrl ? "yes" : "no",
              updatedAt: l.updatedAt,
            })),
            ["id", "name", "category", "mainImage", "updatedAt"],
          )
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("get <id>")
    .description("show one location by id (full asset arrays + pending jobs)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.locations.get(id)
        if (opts.json) emit(result, opts)
        else console.log(JSON.stringify(result, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create <name>")
    .description("create a new location row (no main image yet — call `generate` next)")
    .requiredOption("--node-id <id>", "canvas node id to bind to")
    .option("--description <desc>", "freeform identity notes")
    .option("--category <category>", "indoor | outdoor | urban | nature | fantasy | sci-fi | historical | futuristic | other")
    .option("--style <style>", "realistic | anime | 3d-pixar | illustration")
    .option("--project <projectId>", "drop the row into this project")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        name: string,
        opts: {
          nodeId: string
          description?: string
          category?: string
          style?: string
          project?: string
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.locations.create({
            nodeId: opts.nodeId,
            projectId: opts.project,
            name,
            description: opts.description,
            category: opts.category,
            style: opts.style,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`created location ${result.id} (${name})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("update <id>")
    .description("update identity fields on an existing location")
    .option("--name <name>")
    .option("--description <desc>")
    .option("--category <category>")
    .option("--style <style>")
    .option("--style-lock <bool>", "lock asset gens to the canonical style (true/false)")
    .option("--canonical-description <desc>", "manually set the LLM-style caption (skips recaption)")
    .option("--expected-updated-at <iso>", "optimistic-concurrency token — fail with 409 on mismatch")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: {
          name?: string
          description?: string
          category?: string
          style?: string
          styleLock?: string
          canonicalDescription?: string
          expectedUpdatedAt?: string
        } & GlobalOpts,
      ) => {
        try {
          const has = [
            opts.name,
            opts.description,
            opts.category,
            opts.style,
            opts.styleLock,
            opts.canonicalDescription,
          ].some((v) => v !== undefined)
          if (!has) {
            throw new Error(
              "nothing to update — provide at least one of --name / --description / --category / --style / --style-lock / --canonical-description",
            )
          }
          const client = buildClient(opts.profile)
          // Build the patch with ONLY the keys the user actually supplied —
          // sending `name: ""` would be parsed as "blank the name" and the
          // route's Zod `min(1)` would 400. Mirrors characters update pattern.
          const patch: Parameters<typeof client.locations.update>[1] = {}
          if (opts.name !== undefined) patch.name = opts.name
          if (opts.description !== undefined) patch.description = opts.description
          if (opts.category !== undefined) patch.category = opts.category
          if (opts.style !== undefined) patch.style = opts.style
          if (opts.styleLock !== undefined) {
            // Commander gives us the raw string — coerce to a bool. Anything
            // other than "true" / "false" becomes a hard error so users don't
            // accidentally pass `--style-lock yes` and silently get `false`.
            if (opts.styleLock === "true") patch.styleLock = true
            else if (opts.styleLock === "false") patch.styleLock = false
            else throw new Error(`--style-lock must be "true" or "false" (got "${opts.styleLock}")`)
          }
          if (opts.canonicalDescription !== undefined) {
            patch.canonicalDescription = opts.canonicalDescription
          }
          if (opts.expectedUpdatedAt !== undefined) {
            patch.expectedUpdatedAt = opts.expectedUpdatedAt
          }
          const result = await client.locations.update(id, patch)
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`updated location ${result.id} (updatedAt ${result.updatedAt})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("soft-delete (archive) a location — restore with `locations restore <id>`")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.locations.delete(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`archived location ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("restore <id>")
    .description("un-archive a soft-deleted location (auto-suffixes name on conflict)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.locations.restore(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`restored location ${result.id} (${result.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("generate")
    .description("trigger main-image generation for a location")
    .requiredOption("--name <name>", "the location's display name (used in the prompt)")
    .option("--description <desc>")
    .option("--user-prompt <prompt>", "additional free-text prompt")
    .option("--category <category>")
    .option("--style <style>")
    .option("--provider <provider>", "image provider (defaults to nano-banana)")
    .option("--count <n>", "1, 2, or 4 candidate main images", "1")
    .option("--attach-to-location-id <id>", "auto-attach result to this location row (count=1 only)")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll the first job until it completes")
    .action(
      async (
        opts: {
          name: string
          description?: string
          userPrompt?: string
          category?: string
          style?: string
          provider?: string
          count: string
          attachToLocationId?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.locations.generate({
            name: opts.name,
            description: opts.description,
            userPrompt: opts.userPrompt,
            category: opts.category as
              | "indoor"
              | "outdoor"
              | "urban"
              | "nature"
              | "fantasy"
              | "sci-fi"
              | "historical"
              | "futuristic"
              | "other"
              | undefined,
            style: opts.style as
              | "realistic"
              | "anime"
              | "3d-pixar"
              | "illustration"
              | undefined,
            provider: opts.provider,
            count: parseCount(opts.count),
            attachToLocationId: opts.attachToLocationId,
          })
          // Normalize both response shapes to a uniform string[] of job ids
          // for downstream rendering. `count=1` returns `{ jobId }`; multi
          // returns `{ jobIds }`.
          const jobIds = "jobIds" in result ? result.jobIds : [result.jobId]
          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }
          success(`generation started — ${jobIds.length} job(s)`)
          for (const jobId of jobIds) {
            console.log(`  ${jobId}`)
          }
          if (!opts.watch) {
            dim(`follow: nodaro jobs get ${jobIds[0]}`)
            return
          }
          await watchUntilTerminal({
            fetch: () => client.jobs.get(jobIds[0]),
            label: jobIds[0],
            ...opts,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("generate-asset <id>")
    .description("trigger a single timeOfDay / weather / season / angle / lighting / custom asset generation")
    .requiredOption(
      "--asset-type <type>",
      `one of ${LOCATION_ASSET_TYPES.join(" | ")}`,
    )
    .requiredOption("--variant <name>", "the named variant (e.g. 'dawn', 'clear', 'wide')")
    .option("--provider <provider>")
    .option("--user-prompt <prompt>")
    .option("--description <desc>")
    .option(
      "--column <col>",
      `override the attach column (required for --asset-type custom): ${LOCATION_ATTACH_COLUMNS.join(" | ")}`,
    )
    .option("--attach-name <name>", "display name to store on the asset entry")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll until completion")
    .action(
      async (
        id: string,
        opts: {
          assetType: string
          variant: string
          provider?: string
          userPrompt?: string
          description?: string
          column?: string
          attachName?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const loc = await client.locations.get(id)
          const inferredColumn = ASSET_TYPE_TO_COLUMN[opts.assetType]
          const resolvedColumn = opts.column ?? inferredColumn
          if (!resolvedColumn) {
            throw new Error(
              `--column is required for --asset-type ${opts.assetType} (no inferred column)`,
            )
          }
          const result = await client.locations.generateAsset({
            assetType: opts.assetType as (typeof LOCATION_ASSET_TYPES)[number],
            variant: opts.variant,
            name: loc.name,
            description: opts.description ?? loc.description ?? undefined,
            userPrompt: opts.userPrompt,
            provider: opts.provider,
            attachToLocationId: id,
            attachToColumn: resolvedColumn as (typeof LOCATION_ATTACH_COLUMNS)[number],
            attachName: opts.attachName ?? opts.variant,
          })
          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }
          success(`generation started — job ${result.jobId}`)
          if (!opts.watch) {
            dim(`follow: nodaro jobs get ${result.jobId}`)
            return
          }
          await watchUntilTerminal({
            fetch: () => client.jobs.get(result.jobId),
            label: result.jobId,
            ...opts,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("approve-main-image <id>")
    .description("approve a completed generate-location job as the location's main image")
    .requiredOption("--candidate-job-id <jobId>", "the candidate job id from `generate`")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { candidateJobId: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.locations.approveMainImage(id, opts.candidateJobId)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`main image approved → ${result.sourceImageUrl}`)
        if (result.canonicalDescription) {
          console.log(`caption: ${result.canonicalDescription}`)
        } else {
          // Empty-string caption means the LLM sub-failed during approval —
          // the main image is still set; user can retry.
          dim("(LLM caption sub-failed — run `locations recaption <id>` to retry)")
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("recaption <id>")
    .description("re-run the LLM caption against the location's current main image")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.locations.recaption(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`caption refreshed`)
        console.log(result.canonicalDescription)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

/**
 * Register the `locations` subcommand group on a commander program.
 * Mirrors the registration pattern used by other commands in
 * `packages/cli/src/index.ts`.
 */
export function registerLocationsCommands(program: Command): void {
  program.addCommand(locationsCommand())
}
