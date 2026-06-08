import { Command } from "commander"
import type {
  CommunityEntityType,
  CommunityReportReason,
  CommunitySort,
  CommunityCard,
} from "@nodaro/shared"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, success, table, type OutputOpts } from "../output.js"

/** Split a comma-separated CLI list into a trimmed, non-empty string[]. */
function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface GlobalOpts extends OutputOpts {
  profile?: string
}

const ENTITY_TYPES: readonly CommunityEntityType[] = ["character", "location", "object"]
const SORTS: readonly CommunitySort[] = ["newest", "popular"]
const REPORT_REASONS: readonly CommunityReportReason[] = [
  "real_person_no_consent",
  "inappropriate",
  "ip_violation",
  "other",
]

/** Columns shared by `browse` and `favorites` table output. */
const CARD_COLUMNS = ["slug", "type", "title", "creator", "clones"] as const

function cardRow(c: CommunityCard): Record<string, unknown> {
  return {
    slug: c.slug,
    type: c.entity_type,
    title: c.title,
    creator: c.creator_display_name,
    clones: c.clone_count,
  }
}

/** Validate a CLI-supplied entity type against the shared union. */
function parseEntityType(value: string): CommunityEntityType {
  if (!ENTITY_TYPES.includes(value as CommunityEntityType)) {
    throw new Error(
      `invalid --type "${value}" — must be one of: ${ENTITY_TYPES.join(", ")}`,
    )
  }
  return value as CommunityEntityType
}

export function communityCommand(): Command {
  const cmd = new Command("community").description(
    "browse, clone, favorite, report, publish, and unpublish community assets",
  )

  cmd
    .command("browse")
    .description("list public community listings (paged via --cursor)")
    .option("--entity-type <type>", "filter by kind: character|location|object")
    .option("--q <text>", "free-text search query")
    .option("--category <cat>", "filter by category")
    .option("--sort <sort>", "ordering: newest|popular")
    .option("--limit <n>", "max results per page", (v) => parseInt(v, 10))
    .option("--cursor <token>", "pagination cursor from a previous page")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: {
          entityType?: string
          q?: string
          category?: string
          sort?: string
          limit?: number
          cursor?: string
        } & GlobalOpts,
      ) => {
        try {
          const entityType =
            opts.entityType === undefined ? undefined : parseEntityType(opts.entityType)
          if (opts.sort !== undefined && !SORTS.includes(opts.sort as CommunitySort)) {
            throw new Error(
              `invalid --sort "${opts.sort}" — must be one of: ${SORTS.join(", ")}`,
            )
          }
          const client = buildClient(opts.profile)
          const result = await client.community.browse({
            entityType,
            q: opts.q,
            category: opts.category,
            sort: opts.sort as CommunitySort | undefined,
            limit: opts.limit,
            cursor: opts.cursor,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          table(result.data.map(cardRow), [...CARD_COLUMNS])
          if (result.nextCursor) {
            dim(`next page: --cursor ${result.nextCursor}`)
          }
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("get <slug>")
    .description("show one community listing by its slug")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.community.get(slug)
        if (opts.json) emit(result, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorites")
    .description("list the community listings you've favorited")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.community.favorites()
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(result.data.map(cardRow), [...CARD_COLUMNS])
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("clone <id>")
    .description("copy a community listing into your library")
    .requiredOption("--type <entityType>", "kind of asset: character|location|object")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { type: string } & GlobalOpts) => {
      try {
        const entityType = parseEntityType(opts.type)
        const client = buildClient(opts.profile)
        const result = await client.community.clone(id, entityType)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`cloned → ${result.entityType} ${result.id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorite <id>")
    .description("toggle a favorite on a community listing")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.community.favorite(id)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(result.favorited ? "favorited" : "unfavorited")
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("report <id>")
    .description("flag a community listing for moderation")
    .requiredOption(
      "--reason <reason>",
      "real_person_no_consent|inappropriate|ip_violation|other",
    )
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { reason: string } & GlobalOpts) => {
      try {
        if (!REPORT_REASONS.includes(opts.reason as CommunityReportReason)) {
          throw new Error(
            `invalid --reason "${opts.reason}" — must be one of: ${REPORT_REASONS.join(", ")}`,
          )
        }
        const client = buildClient(opts.profile)
        const result = await client.community.report(
          id,
          opts.reason as CommunityReportReason,
        )
        if (opts.json) {
          emit(result, opts)
          return
        }
        success("reported")
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("publish <entityType> <id>")
    .description(
      "share one of YOUR entities to the community (admin token); requires --consent",
    )
    .requiredOption("--title <t>", "public listing title")
    .option("--description <d>", "public listing description")
    .option("--category <c>", "listing category")
    .option("--style <s>", "listing style tag")
    .option("--tags <list>", "comma-separated tags", parseList)
    .option(
      "--consent",
      "attest you have the rights to share this publicly (required)",
    )
    .option(
      "--likeness-consent",
      "attest to rights/consent of any real person depicted, 18+ (required for characters)",
    )
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        entityType: string,
        id: string,
        opts: {
          title: string
          description?: string
          category?: string
          style?: string
          tags?: string[]
          consent?: boolean
          likenessConsent?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const parsedEntityType = parseEntityType(entityType)
          if (!opts.consent) {
            throw new Error(
              "publishing requires --consent (you attest you have the rights to share this publicly)",
            )
          }
          if (parsedEntityType === "character" && !opts.likenessConsent) {
            throw new Error(
              "characters require --likeness-consent (rights/consent of any real person depicted, 18+)",
            )
          }
          const client = buildClient(opts.profile)
          const result = await client.community.publish(parsedEntityType, id, {
            title: opts.title,
            description: opts.description,
            category: opts.category,
            style: opts.style,
            tags: opts.tags,
            attestation: true,
            likenessAttestation: opts.likenessConsent,
          })
          if (opts.json) {
            emit(result, opts)
            return
          }
          success(`shared → ${result.slug}`)
          emit(result, { json: true })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("unpublish <listingId>")
    .description("unshare (deactivate) a listing you published (admin token)")
    .option("--profile <name>")
    .option("--json")
    .action(async (listingId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.community.unpublish(listingId)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`unshared listing ${listingId}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("shared-status <entityType> <sourceId>")
    .description(
      "look up YOUR existing listing (if any) for a source entity (admin token)",
    )
    .option("--profile <name>")
    .option("--json")
    .action(async (entityType: string, sourceId: string, opts: GlobalOpts) => {
      try {
        const parsedEntityType = parseEntityType(entityType)
        const client = buildClient(opts.profile)
        const result = await client.community.sharedListing(parsedEntityType, sourceId)
        if (opts.json) {
          emit(result, opts)
          return
        }
        if (result.data) detail(result.data)
        else success("not shared")
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
