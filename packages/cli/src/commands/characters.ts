import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, dim, type OutputOpts } from "../output.js"
import { watchUntilTerminal } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * Coerce the --count flag value into the union the SDK expects.
 * Defaults to 1 on any other value; the SDK will further validate.
 */
function parseCount(raw: string | undefined): 1 | 2 | 4 {
  if (raw === "2") return 2
  if (raw === "4") return 4
  return 1
}

export function charactersCommand(): Command {
  const cmd = new Command("characters").description(
    "list, inspect, and manage characters; trigger portrait / asset / motion generation",
  )

  cmd
    .command("list")
    .description("list characters (active by default)")
    .option("--project <projectId>", "filter to one project")
    .option("--archived", "show archived characters instead of active ones")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { project?: string; archived?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.list({
          projectId: opts.project,
          archived: opts.archived,
        })
        if (opts.json) {
          emit(result.characters, opts)
          return
        }
        table(
          result.characters.map((c) => ({
            id: c.id,
            name: c.name,
            portrait: c.sourceImageUrl ? "yes" : "no",
            updatedAt: c.updatedAt,
          })),
          ["id", "name", "portrait", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one character by id (full asset arrays + pending jobs)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.get(id)
        if (opts.json) emit(result, opts)
        else console.log(JSON.stringify(result, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a new character row (no portrait yet — call `generate` next)")
    .requiredOption("--name <name>", "display name (unique per user)")
    .option("--description <desc>", "freeform identity notes")
    .option("--gender <gender>")
    .option("--style <style>", "one of realistic|anime|3d-pixar|illustration")
    .option("--base-outfit <outfit>", "default wardrobe description")
    .option("--seed-prompt <prompt>", "scaffold prompt for portrait generation")
    .option("--node-id <id>", "canvas node id to bind to", "mcp-managed")
    .option("--project <projectId>", "drop the row into this project")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: {
          name: string
          description?: string
          gender?: string
          style?: string
          baseOutfit?: string
          seedPrompt?: string
          nodeId: string
          project?: string
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.characters.create({
            nodeId: opts.nodeId,
            projectId: opts.project,
            name: opts.name,
            description: opts.description,
            gender: opts.gender,
            // Style is validated server-side; we pass through as-is.
            style: opts.style as
              | "realistic"
              | "anime"
              | "3d-pixar"
              | "illustration"
              | undefined,
            baseOutfit: opts.baseOutfit,
            seedPrompt: opts.seedPrompt,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`created character ${result.id} (${result.name ?? opts.name})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("update <id>")
    .description("update identity fields on an existing character")
    .option("--name <name>")
    .option("--description <desc>")
    .option("--gender <gender>")
    .option("--style <style>", "realistic|anime|3d-pixar|illustration")
    .option("--base-outfit <outfit>")
    .option("--seed-prompt <prompt>")
    .option("--node-id <id>", "canvas node id (required on update too)", "mcp-managed")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: {
          name?: string
          description?: string
          gender?: string
          style?: string
          baseOutfit?: string
          seedPrompt?: string
          nodeId: string
        } & GlobalOpts,
      ) => {
        try {
          const has = [
            opts.name,
            opts.description,
            opts.gender,
            opts.style,
            opts.baseOutfit,
            opts.seedPrompt,
          ].some((v) => v !== undefined)
          if (!has) {
            throw new Error(
              "nothing to update — provide at least one of --name / --description / --gender / --style / --base-outfit / --seed-prompt",
            )
          }
          const client = buildClient(opts.profile)
          const result = await client.characters.update(id, {
            nodeId: opts.nodeId,
            // upsert needs `name` to be a string when supplied; if --name was
            // omitted, the SDK type allows undefined but the route ignores
            // unset fields on UPDATE, so we just forward what the user gave.
            name: opts.name ?? "",
            description: opts.description,
            gender: opts.gender,
            style: opts.style as
              | "realistic"
              | "anime"
              | "3d-pixar"
              | "illustration"
              | undefined,
            baseOutfit: opts.baseOutfit,
            seedPrompt: opts.seedPrompt,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`updated character ${result.id}`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("soft-delete (archive) a character — restore with `characters restore <id>`")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.delete(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`archived character ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("restore <id>")
    .description("un-archive a soft-deleted character (auto-suffixes name on conflict)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.restore(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`restored character ${result.id} (${result.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("duplicate <id>")
    .description("fork a character to a new row with a (copy) suffix")
    .option("--node-id <id>", "canvas node id for the new row")
    .option("--project <projectId>", "drop the copy into this project")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (id: string, opts: { nodeId?: string; project?: string } & GlobalOpts) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.characters.duplicate(id, {
            nodeId: opts.nodeId,
            projectId: opts.project,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`duplicated character ${id} → ${result.id} (${result.name})`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("usage <id>")
    .description("show which workflows reference this character")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.usage(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        console.log(`${result.workflowCount} workflows reference this character`)
        if (result.workflows.length > 0) {
          table(result.workflows, ["id", "name"])
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("generate <id>")
    .description("trigger portrait generation for a character")
    .option("--seed-prompt <prompt>")
    .option("--description <desc>")
    .option("--provider <provider>", "image provider (defaults to nano-banana)")
    .option("--count <n>", "1, 2, or 4 candidate portraits", "1")
    .option("--name <name>", "override the character's display name in the prompt")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll the first job until it completes")
    .action(
      async (
        id: string,
        opts: {
          seedPrompt?: string
          description?: string
          provider?: string
          count: string
          name?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          // Fetch the character first so we have a name + identity fields to
          // pass to the route (the route requires `name`).
          const char = await client.characters.get(id)
          const result = await client.characters.generate({
            name: opts.name ?? char.name,
            seedPrompt: opts.seedPrompt ?? char.sourceImageUrl ? undefined : char.description ?? undefined,
            description: opts.description ?? char.description ?? undefined,
            provider: opts.provider,
            count: parseCount(opts.count),
            attachToCharacterId: id,
          })
          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }
          success(`generation started — ${result.jobIds.length} job(s)`)
          for (const jobId of result.jobIds) {
            console.log(`  ${jobId}`)
          }
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
    .command("generate-asset <id>")
    .description("trigger a single expression / pose / lighting / angle asset generation")
    .requiredOption(
      "--asset-type <type>",
      "expressions | poses | lighting | angles | headAngles | bodyAngles | custom",
    )
    .requiredOption("--variant <name>", "the named variant (e.g. 'smile', 'standing')")
    .option("--provider <provider>")
    .option("--user-prompt <prompt>", "additional free-text prompt for the asset")
    .option("--description <desc>")
    .option("--column <col>", "expressions | poses | angles | body_angles | lighting_variations")
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
          const char = await client.characters.get(id)
          const result = await client.characters.generateAsset({
            assetType: opts.assetType as
              | "expressions"
              | "poses"
              | "lighting"
              | "angles"
              | "headAngles"
              | "bodyAngles"
              | "custom",
            variant: opts.variant,
            name: char.name,
            description: opts.description ?? char.description ?? undefined,
            userPrompt: opts.userPrompt,
            provider: opts.provider,
            attachToCharacterId: id,
            attachToColumn: (opts.column ??
              (opts.assetType === "lighting" ? "lighting_variations" : opts.assetType)) as
              | "expressions"
              | "poses"
              | "angles"
              | "body_angles"
              | "lighting_variations",
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
    .command("generate-motion <id>")
    .description("animate the character's portrait into a motion clip")
    .requiredOption("--motion-prompt <prompt>")
    .option("--attach-name <name>", "display name for the motion entry")
    .option("--provider <provider>", "i2v provider; defaults to kling")
    .option("--description <desc>")
    .option("--motion-description <desc>", "tight description of WHAT moves and HOW")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll the motion job until completion")
    .action(
      async (
        id: string,
        opts: {
          motionPrompt: string
          attachName?: string
          provider?: string
          description?: string
          motionDescription?: string
          watch?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const char = await client.characters.get(id)
          const result = await client.characters.generateMotion({
            motionPrompt: opts.motionPrompt,
            name: char.name,
            attachToCharacterId: id,
            attachName: opts.attachName,
            provider: opts.provider,
            description: opts.description ?? char.description ?? undefined,
            motionDescription: opts.motionDescription,
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
    .command("approve-portrait <id>")
    .description("approve a completed generate-character job as the character's portrait")
    .requiredOption("--job <jobId>", "the candidate job id from `generate`")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { job: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.approvePortrait(id, opts.job)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`portrait approved → ${result.portraitUrl}`)
        if (result.canonicalDescription) {
          console.log(`caption: ${result.canonicalDescription}`)
        } else {
          dim("(LLM caption sub-failed — run `characters recaption <id>` to retry)")
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("recaption <id>")
    .description("re-run the LLM caption against the character's current portrait")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.characters.recaption(id)
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
