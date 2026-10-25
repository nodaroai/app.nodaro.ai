import { Command } from "commander"
import type { JobRating, JobRatingFilter, JobSource, JobStatus } from "@nodaro/sdk/jobs"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface ListOpts extends GlobalOpts {
  status?: string
  type?: string
  origin?: string
  source?: string
  favorited?: boolean
  rating?: string
  project?: string
  inSession?: boolean
  withSessions?: boolean
  limit?: string
  cursor?: string
}

const RATING_FILTERS: readonly JobRatingFilter[] = ["good", "bad", "rated", "unrated"]

/** Comma-separated values from one option. */
function list(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const values = value.split(",").map((v) => v.trim()).filter(Boolean)
  return values.length > 0 ? values : undefined
}

function ratingFilter(value: string | undefined): JobRatingFilter | undefined {
  if (value === undefined) return undefined
  if (!(RATING_FILTERS as readonly string[]).includes(value)) {
    throw new Error(`--rating takes ${RATING_FILTERS.join(", ")} (got "${value}")`)
  }
  return value as JobRatingFilter
}

/** `good` / `bad`, or `clear` for none. */
function ratingArg(value: string): JobRating | null {
  if (value === "clear") return null
  if (value === "good" || value === "bad") return value
  throw new Error(`a rating is good, bad or clear (got "${value}")`)
}

export function jobsCommand(): Command {
  const cmd = new Command("jobs").description("list, inspect, rate, cancel, delete and restore jobs")

  cmd
    .command("list")
    .description("your jobs, newest first")
    .option("--status <statuses>", "only these statuses, comma-separated (e.g. failed,cancelled)")
    .option("--type <types>", "only these input_data.type values, comma-separated (e.g. generate-image)")
    .option("--origin <origin>", "only jobs this client app sent")
    .option("--source <sources>", "only jobs these surfaces created, comma-separated (mcp, web, cli, sdk, extension, app, api, internal)")
    .option("--favorited", "only jobs you favorited")
    .option("--no-favorited", "only jobs you did not favorite")
    .option("--rating <rating>", "good, bad, rated (any) or unrated")
    .option("--project <id>", "only jobs a session of this project holds now (none: a session with no project)")
    .option("--in-session", "only jobs at least one session holds")
    .option("--no-in-session", "only jobs no session holds (General)")
    .option("--with-sessions", "show the sessions each job is in")
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: ListOpts) => {
      try {
        const rating = ratingFilter(opts.rating)
        const client = buildClient(opts.profile)
        const page = await client.jobs.list({
          status: list(opts.status) as JobStatus[] | undefined,
          type: list(opts.type),
          origin: opts.origin,
          source: list(opts.source) as JobSource[] | undefined,
          favorited: opts.favorited,
          rating,
          projectId: opts.project,
          inSession: opts.inSession,
          withSessions: opts.withSessions,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((job) => ({
            id: job.id,
            status: job.status,
            type: (job.input_data as { type?: unknown } | null)?.type ?? job.job_type ?? "",
            favorited: job.favorited ? "yes" : "",
            rating: job.rating ?? "",
            ...(opts.withSessions ? { sessions: (job.sessions ?? []).map((s) => s.title ?? s.id).join(", ") } : {}),
            created: job.created_at,
          })),
          ["id", "status", "type", "favorited", "rating", ...(opts.withSessions ? ["sessions"] : []), "created"],
        )
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one job by id")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.jobs.get(id)
        if (opts.json) emit(result.data, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("rate <id> <rating>")
    .description("rate one of your jobs: good, bad, or clear to remove the rating")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, value: string, opts: GlobalOpts) => {
      try {
        const rating = ratingArg(value)
        const client = buildClient(opts.profile)
        const result = await client.jobs.rate(id, rating)
        if (opts.json) emit(result, opts)
        else success(rating ? `rated job ${id} ${rating}` : `cleared the rating of job ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("cancel <id>")
    .description("cancel a pending or running job")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.jobs.cancel(id)
        if (opts.json) emit(result, opts)
        else success(`cancelled job ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete a job: to the Trash for 30 days, then for good (--forever: a job already in the Trash, now)")
    .option("--forever", "delete a job already in the Trash for good, now")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { forever?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.jobs.delete(id, { forever: opts.forever })
        if (opts.json) emit(result, opts)
        else success(opts.forever ? `deleted job ${id} for good` : `deleted job ${id} (in the Trash for 30 days)`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("restore <id>")
    .description("bring a deleted job back from the Trash, into the sessions it was in")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.jobs.restore(id)
        if (opts.json) emit(result, opts)
        else success(`restored job ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
