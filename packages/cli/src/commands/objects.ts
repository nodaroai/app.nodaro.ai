import { Command, Option } from "commander"
import {
  OBJECT_ASSET_TYPES,
  OBJECT_ATTACH_COLUMNS,
  type ObjectAspectRatio,
  type ObjectAssetType,
  type ObjectAttachColumn,
  type ObjectCategory,
} from "@nodaro/client"

const OBJECT_CATEGORIES = [
  "furniture",
  "vehicle",
  "weapon",
  "food",
  "clothing",
  "electronics",
  "nature",
  "tool",
  "animal",
  "other",
] as const

const OBJECT_STYLES = ["realistic", "anime", "3d-pixar", "illustration"] as const
const ASPECT_RATIOS = ["1:1", "3:4", "16:9", "9:16", "4:3"] as const

const MOTION_PROVIDERS = [
  "kling-turbo",
  "kling",
  "kling-3.0",
  "minimax",
  "hailuo-2.3",
  "wan-i2v",
  "seedance",
  "bytedance-lite",
] as const
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, table, dim, type OutputOpts } from "../output.js"
import { parseCount, watchUntilTerminal } from "../util.js"
import { parseBoolFlag } from "../params.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
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
        else detail(result)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create <name>")
    .description("create a new object row (no main image yet — call `generate` next)")
    .requiredOption("--node-id <id>", "canvas node id to bind to")
    .option("--description <desc>", "freeform identity notes")
    .addOption(new Option("--category <category>", "object category").choices([...OBJECT_CATEGORIES]))
    .addOption(new Option("--style <style>", "object visual style").choices([...OBJECT_STYLES]))
    .option("--project <projectId>", "drop the row into this project")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        name: string,
        opts: {
          nodeId: string
          description?: string
          category?: ObjectCategory
          style?: (typeof OBJECT_STYLES)[number]
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
            category: opts.category,
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
    .addOption(new Option("--category <category>", "object category").choices([...OBJECT_CATEGORIES]))
    .addOption(new Option("--style <style>", "object visual style").choices([...OBJECT_STYLES]))
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
          category?: ObjectCategory
          style?: (typeof OBJECT_STYLES)[number]
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
          if (opts.category !== undefined) patch.category = opts.category
          if (opts.style !== undefined) patch.style = opts.style
          if (opts.styleLock !== undefined) {
            patch.styleLock = parseBoolFlag(opts.styleLock, "style-lock")
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
    .addOption(new Option("--category <category>", "object category").choices([...OBJECT_CATEGORIES]))
    .addOption(new Option("--style <style>", "object visual style").choices([...OBJECT_STYLES]))
    .option("--provider <provider>", "image provider (defaults to nano-banana)")
    .option("--count <n>", "1, 2, or 4 candidate main images", "1")
    .option("--attach-to-object-id <id>", "auto-attach result to this object row (count=1 only)")
    .option("--seed-prompt-hint <hint>", "parameter-picker prompt-fragment pass-through")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll all jobs until they complete (parallel)")
    .action(
      async (
        opts: {
          name: string
          description?: string
          userPrompt?: string
          category?: ObjectCategory
          style?: (typeof OBJECT_STYLES)[number]
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
            category: opts.category,
            style: opts.style,
            provider: opts.provider,
            count: parseCount(opts.count),
            attachToObjectId: opts.attachToObjectId,
            seedPromptHint: opts.seedPromptHint,
          })
          // The SDK normalizes to `{ jobIds: string[] }` (one id per
          // candidate); fall back to the legacy `{ jobId }` shape defensively.
          const jobIds = result.jobIds ?? (result.jobId ? [result.jobId] : [])
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
          // Watch ALL jobs in parallel — `--count 2/4` returns multiple jobIds
          // and `watchUntilTerminal` on just `jobIds[0]` would leave the others
          // unmonitored.
          await Promise.all(
            jobIds.map((id) =>
              watchUntilTerminal({
                fetch: () => client.jobs.get(id),
                label: id,
                ...opts,
              }),
            ),
          )
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("generate-asset")
    .description("trigger a single angles / materials / variations / motion / custom asset generation")
    .addOption(
      new Option("--asset-type <type>", "asset bucket to generate into").choices([...OBJECT_ASSET_TYPES]),
    )
    .requiredOption("--variant <name>", "the named variant (e.g. 'front', 'wood', 'weathered')")
    .requiredOption("--attach-to-object-id <id>", "object row to append the result to")
    .addOption(
      new Option("--attach-to-column <col>", "override the attach column (required for --asset-type custom)").choices([
        ...OBJECT_ATTACH_COLUMNS,
      ]),
    )
    .option("--name <name>", "object's display name (avoids an extra GET to fetch it)")
    .option("--description <desc>", "object's description (avoids an extra GET to fetch it)")
    .option("--seed-prompt-hint <hint>", "parameter-picker prompt-fragment pass-through")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll until completion")
    .action(
      async (
        opts: {
          assetType: ObjectAssetType
          variant: string
          attachToObjectId: string
          attachToColumn?: ObjectAttachColumn
          name?: string
          description?: string
          seedPromptHint?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          if (!opts.assetType) {
            throw new Error("--asset-type is required")
          }
          const client = buildClient(opts.profile)
          // Lazy fetch — only round-trip when the caller didn't supply name/desc.
          let name = opts.name
          let description = opts.description
          if (name === undefined || description === undefined) {
            const obj = await client.objects.get(opts.attachToObjectId)
            name ??= obj.name
            description ??= obj.description ?? undefined
          }
          const inferredColumn = ASSET_TYPE_TO_COLUMN[opts.assetType]
          const resolvedColumn = opts.attachToColumn ?? inferredColumn
          if (!resolvedColumn) {
            throw new Error(
              `--attach-to-column is required for --asset-type ${opts.assetType} (no inferred column)`,
            )
          }
          const result = await client.objects.generateAsset({
            assetType: opts.assetType,
            variant: opts.variant,
            name,
            description,
            attachToObjectId: opts.attachToObjectId,
            attachToColumn: resolvedColumn,
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
    .addOption(
      new Option("--provider <provider>", "i2v provider")
        .choices([...MOTION_PROVIDERS])
        .default("kling-turbo"),
    )
    .addOption(
      new Option("--style <style>", "object visual style")
        .choices([...OBJECT_STYLES])
        .default("realistic"),
    )
    .option("--canonical-description <desc>", "LLM caption to anchor the prompt with")
    .option(
      "--attach-to-object-id <id>",
      "auto-attach result to this object's motion_clips bucket",
    )
    .option(
      "--attach-name <name>",
      "display name for the motion_clips entry (paired with --attach-to-object-id)",
    )
    .addOption(
      new Option("--aspect-ratio <ratio>", "aspect ratio (default 1:1 product-showcase)")
        .choices([...ASPECT_RATIOS])
        .default("1:1"),
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
          provider: (typeof MOTION_PROVIDERS)[number]
          style: (typeof OBJECT_STYLES)[number]
          canonicalDescription?: string
          attachToObjectId?: string
          attachName?: string
          aspectRatio?: ObjectAspectRatio
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
            style: opts.style,
            canonicalDescription: opts.canonicalDescription,
            attachToObjectId: opts.attachToObjectId,
            attachName: opts.attachName,
            seedPromptHint: opts.seedPromptHint,
            aspectRatio: opts.aspectRatio,
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
