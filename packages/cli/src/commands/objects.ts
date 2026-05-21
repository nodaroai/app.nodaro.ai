import { Command } from "commander"
import {
  OBJECT_ASSET_TYPES,
  OBJECT_ATTACH_COLUMNS,
  type ObjectAspectRatio,
} from "@nodaro/client"
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
 * Asset-type → DB-column dispatch table. Object asset types are mostly
 * self-named — `angles` → `angles`, `materials` → `materials`,
 * `variations` → `variations`. Only `motion` maps to a different column name
 * (`motion_clips`) since the column already existed when the type was added.
 *
 * `custom` has no mapping — callers must pass `--attach-to-column` explicitly
 * so the worker knows which bucket to write to.
 */
const ASSET_TYPE_TO_COLUMN: Record<string, (typeof OBJECT_ATTACH_COLUMNS)[number]> = {
  angles: "angles",
  materials: "materials",
  variations: "variations",
  motion: "motion_clips",
}

export function objectsCommand(): Command {
  const cmd = new Command("objects").description(
    "list, inspect, and manage objects; trigger main-image / asset generation",
  )

  cmd
    .command("list")
    .description("list objects (active by default)")
    .option("--project <id>", "scope to a specific project")
    .option("--archived", "show archived objects instead of active ones")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (opts: { archived?: boolean; project?: string } & GlobalOpts) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.objects.list({
            archived: opts.archived,
            projectId: opts.project,
          })
          if (opts.json) {
            emit(result.objects, opts)
            return
          }
          table(
            result.objects.map((o) => ({
              id: o.id,
              name: o.name,
              category: o.category ?? "",
              mainImage: o.sourceImageUrl ? "yes" : "no",
              updatedAt: o.updatedAt,
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
    .description("show one object by id (full asset arrays + pending jobs)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.objects.get(id)
        if (opts.json) emit(result, opts)
        else console.log(JSON.stringify(result, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create <name>")
    .description("create a new object row (no main image yet — call `generate` next)")
    .requiredOption("--node-id <id>", "canvas node id to bind to")
    .option("--description <desc>", "freeform identity notes")
    .option("--category <category>", "furniture | vehicle | weapon | food | clothing | electronics | nature | tool | animal | other")
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
          const result = await client.objects.create({
            nodeId: opts.nodeId,
            projectId: opts.project,
            name,
            description: opts.description,
            category: opts.category as
              | "furniture"
              | "vehicle"
              | "weapon"
              | "food"
              | "clothing"
              | "electronics"
              | "nature"
              | "tool"
              | "animal"
              | "other"
              | undefined,
            style: opts.style,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`created object ${result.id} (${name})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("update <id>")
    .description("update identity fields on an existing object")
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
          // route's Zod `min(1)` would 400. Mirrors locations update pattern.
          const patch: Parameters<typeof client.objects.update>[1] = {}
          if (opts.name !== undefined) patch.name = opts.name
          if (opts.description !== undefined) patch.description = opts.description
          if (opts.category !== undefined) {
            patch.category = opts.category as
              | "furniture"
              | "vehicle"
              | "weapon"
              | "food"
              | "clothing"
              | "electronics"
              | "nature"
              | "tool"
              | "animal"
              | "other"
          }
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
          const result = await client.objects.update(id, patch)
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`updated object ${result.id} (updatedAt ${result.updatedAt})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("soft-delete (archive) an object — restore with `objects restore <id>`")
    .option("--permanent", "permanently delete (archived rows only)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { permanent?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        if (opts.permanent) {
          const result = await client.objects.permanentDelete(id)
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`permanently deleted object ${id}`)
          return
        }
        const result = await client.objects.delete(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`archived object ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("restore <id>")
    .description("un-archive a soft-deleted object (auto-suffixes name on conflict)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.objects.restore(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`restored object ${result.id} (${result.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("generate")
    .description("trigger main-image generation for an object")
    .requiredOption("--name <name>", "the object's display name (used in the prompt)")
    .option("--description <desc>")
    .option("--user-prompt <prompt>", "additional free-text prompt")
    .option("--category <category>")
    .option("--style <style>")
    .option("--provider <provider>", "image provider (defaults to nano-banana)")
    .option("--count <n>", "1, 2, or 4 candidate main images", "1")
    .option("--attach-to-object-id <id>", "auto-attach result to this object row (count=1 only)")
    .option("--seed-prompt-hint <hint>", "parameter-picker prompt-fragment pass-through")
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
          attachToObjectId?: string
          seedPromptHint?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.objects.generate({
            name: opts.name,
            description: opts.description,
            userPrompt: opts.userPrompt,
            category: opts.category as
              | "furniture"
              | "vehicle"
              | "weapon"
              | "food"
              | "clothing"
              | "electronics"
              | "nature"
              | "tool"
              | "animal"
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
            attachToObjectId: opts.attachToObjectId,
            seedPromptHint: opts.seedPromptHint,
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
    .command("generate-asset")
    .description("trigger a single angles / materials / variations / motion / custom asset generation")
    .requiredOption(
      "--asset-type <type>",
      `one of ${OBJECT_ASSET_TYPES.join(" | ")}`,
    )
    .requiredOption("--variant <name>", "the named variant (e.g. 'front', 'wood', 'weathered')")
    .requiredOption("--attach-to-object-id <id>", "object row to append the result to")
    .option(
      "--attach-to-column <col>",
      `override the attach column (required for --asset-type custom): ${OBJECT_ATTACH_COLUMNS.join(" | ")}`,
    )
    .option("--seed-prompt-hint <hint>", "parameter-picker prompt-fragment pass-through")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll until completion")
    .action(
      async (
        opts: {
          assetType: string
          variant: string
          attachToObjectId: string
          attachToColumn?: string
          seedPromptHint?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const obj = await client.objects.get(opts.attachToObjectId)
          const inferredColumn = ASSET_TYPE_TO_COLUMN[opts.assetType]
          const resolvedColumn = opts.attachToColumn ?? inferredColumn
          if (!resolvedColumn) {
            throw new Error(
              `--attach-to-column is required for --asset-type ${opts.assetType} (no inferred column)`,
            )
          }
          const result = await client.objects.generateAsset({
            assetType: opts.assetType as (typeof OBJECT_ASSET_TYPES)[number],
            variant: opts.variant,
            name: obj.name,
            description: obj.description ?? undefined,
            attachToObjectId: opts.attachToObjectId,
            attachToColumn: resolvedColumn as (typeof OBJECT_ATTACH_COLUMNS)[number],
            attachName: opts.variant,
            seedPromptHint: opts.seedPromptHint,
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
    .command("generate-motion")
    .description(
      "animate the object's main image into a motion clip (rotation, orbit, hover, drift)",
    )
    .requiredOption("--name <name>", "the object's display name (used in the prompt)")
    .requiredOption("--motion-prompt <prompt>", "describe WHAT moves and HOW (rotate, orbit, hover)")
    .requiredOption(
      "--source-image-url <url>",
      "URL of the product-shot to animate",
    )
    .option(
      "--provider <provider>",
      "i2v provider — one of kling | kling-turbo | kling-3.0 | wan-i2v | wan-2.7-i2v | seedance-2",
      "kling-turbo",
    )
    .option("--style <style>", "realistic | anime | 3d-pixar | illustration", "realistic")
    .option("--canonical-description <desc>", "LLM caption to anchor the prompt with")
    .option(
      "--attach-to-object-id <id>",
      "auto-attach result to this object's motion_clips bucket",
    )
    .option(
      "--attach-name <name>",
      "display name for the motion_clips entry (paired with --attach-to-object-id)",
    )
    .option(
      "--aspect-ratio <ratio>",
      "override default 1:1 — one of 1:1 | 3:4 | 16:9 | 9:16 | 4:3",
      "1:1",
    )
    .option("--seed-prompt-hint <hint>", "parameter-picker prompt-fragment pass-through")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll the motion job until completion")
    .action(
      async (
        opts: {
          name: string
          motionPrompt: string
          sourceImageUrl: string
          provider: string
          style: string
          canonicalDescription?: string
          attachToObjectId?: string
          attachName?: string
          aspectRatio?: string
          seedPromptHint?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.objects.generateMotion({
            name: opts.name,
            motionPrompt: opts.motionPrompt,
            sourceImageUrl: opts.sourceImageUrl,
            provider: opts.provider,
            // Commander hands us a raw string; the SDK's union is the
            // canonical 4-value style set. We narrow here so a typo (e.g.
            // `--style anim`) doesn't silently send a value the route's Zod
            // would reject — surface a clear CLI error instead.
            style: opts.style as
              | "realistic"
              | "anime"
              | "3d-pixar"
              | "illustration",
            canonicalDescription: opts.canonicalDescription,
            attachToObjectId: opts.attachToObjectId,
            attachName: opts.attachName,
            seedPromptHint: opts.seedPromptHint,
            // `aspectRatio` is a 5-value object union (1:1 / 3:4 / 16:9 /
            // 9:16 / 4:3 — includes 4:3 for product-showcase framing, distinct
            // from the character/location set). We pass commander's raw string
            // through with a narrowing cast; the route's Zod enum is the
            // source of truth on rejection — keeping the CLI thin avoids
            // drift if we ever extend the option set.
            aspectRatio: opts.aspectRatio as ObjectAspectRatio | undefined,
          })
          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }
          success(`motion generation started — job ${result.jobId}`)
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
    .description("approve a completed generate-object job as the object's main image")
    .requiredOption("--candidate-job-id <jobId>", "the candidate job id from `generate`")
    .option(
      "--expected-updated-at <iso>",
      "optimistic-concurrency token — fail with 409 on mismatch",
    )
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: { candidateJobId: string; expectedUpdatedAt?: string } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.objects.approveMainImage(
            id,
            opts.candidateJobId,
            opts.expectedUpdatedAt,
          )
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
            dim("(LLM caption sub-failed — run `objects recaption <id>` to retry)")
          }
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("recaption <id>")
    .description("re-run the LLM caption against the object's current main image")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.objects.recaption(id)
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
 * Register the `objects` subcommand group on a commander program.
 * Mirrors the registration pattern used by other commands in
 * `packages/cli/src/index.ts`.
 */
export function registerObjectsCommands(program: Command): void {
  program.addCommand(objectsCommand())
}
