/** OpenAPI entries for `/v1/jobs` (routes in `jobs.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { JOB_STATUSES } from "../lib/job-status.js"
import { JOB_SOURCES } from "../lib/job-source.js"
import { JOB_RATINGS, JOB_RATING_FILTERS } from "../lib/job-ratings.js"
import { MAX_JOB_LIST_FILTER_VALUES } from "../lib/job-list-filters.js"

/** What `output_data` says of an image job's size — shared by Job and JobStatus. */
const OUTPUT_DATA_DESCRIPTION =
  "The job's result; its keys depend on the job. An image job publishes `imageUrl` (and `imageUrls` when it made several) " +
  "with the image's pixel size: `width` / `height` (integers) of `imageUrl` as stored, EXIF orientation applied, and — beside " +
  "`imageUrls` — `images`, one `{ url, width, height }` per entry in the same order (an entry whose size could not be read has only `url`). " +
  "Present on image jobs completed after the size was recorded; absent when it could not be read."

const JobSummary = z
  .object({
    id: z.string().uuid(),
    status: z.enum(JOB_STATUSES),
    progress: z.number().min(0).max(100),
    user_id: z.string().uuid(),
    input_data: z.unknown(),
    output_data: z.unknown().describe(OUTPUT_DATA_DESCRIPTION),
    error_message: z.string().nullable(),
    cost: z.number().nullable(),
    credits: z
      .number()
      .nullable()
      .describe("Credits HELD for this job when it was accepted. Never changes; a job can settle below it."),
    credits_charged: z
      .number()
      .nullable()
      .optional()
      .describe(
        "Credits actually charged once the hold settled — can be below `credits` (the unused part goes back to the balance); 0 when refunded. null while the job is still running, or when it reserved nothing of its own.",
      ),
    credit_status: z
      .enum(["reserved", "committed", "refunded"])
      .nullable()
      .optional()
      .describe("The hold's lifecycle: reserved (still held), committed (charged) or refunded."),
    job_type: z.string().nullable(),
    session_id: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe("The generation session this job was born in (sent as `sessionId` on the generation request), or null."),
    sessions: z
      .array(z.object({ id: z.string().uuid(), title: z.string().nullable(), projectId: z.string().uuid().nullable() }))
      .optional()
      .describe("With `withSessions=true` on the list: every session that holds the job now (a live link), each linkable. Empty when the job is in no session."),
    deleted_at: z
      .string()
      .nullable()
      .optional()
      .describe("When the job was deleted, on a job read from the Trash (`GET /v1/trash`). A deleted job is left out of every other read, so it is otherwise absent or null."),
    created_at: z.string(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    recovering: z
      .boolean()
      .optional()
      .describe(
        "Present (true) while the platform's reconcile system is self-healing this job — it will complete or be refunded automatically.",
      ),
    favorited: z
      .boolean()
      .optional()
      .describe("Whether the job's owner favorited it (`POST /v1/gallery/favorite`)."),
    rating: z
      .enum(JOB_RATINGS)
      .nullable()
      .optional()
      .describe("The owner's rating of the job (`PUT /v1/jobs/{id}/rating`), or null when unrated."),
  })
  .openapi("Job")

// Lean status shape for the per-node poll path (every ~3s). Selects only the
// fields a poller needs (status + progress + output/error, and when the job
// finished) — no input_data, cost or provider columns — to keep the hot-path
// payload small.
const JobStatus = z
  .object({
    id: z.string().uuid(),
    status: z.enum(JOB_STATUSES),
    progress: z.number().min(0).max(100),
    output_data: z.unknown().describe(OUTPUT_DATA_DESCRIPTION),
    error_message: z.string().nullable(),
    completed_at: z
      .string()
      .nullable()
      .describe("When the job finished, on the server's clock; null until it has."),
    recovering: z
      .boolean()
      .optional()
      .describe(
        "Present (true) while the platform's reconcile system is self-healing this job — the worker abandoned it after the provider delivered; it will complete or be refunded automatically.",
      ),
  })
  .openapi("JobStatus")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/jobs/{id}",
  description: "Get the status and result of a single job.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Job details",
      content: {
        "application/json": {
          schema: z.object({ data: JobSummary }),
        },
      },
    },
    401: { description: "Unauthorized" },
    404: { description: "Job not found" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/jobs/{id}/status",
  description:
    "Lightweight job status for polling. Returns only status, progress, output, error, and when the job finished — no input_data or cost.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Job status",
      content: {
        "application/json": {
          schema: z.object({ data: JobStatus }),
        },
      },
    },
    401: { description: "Unauthorized" },
    404: { description: "Job not found" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/jobs",
  description:
    "Your jobs, newest first, cursor-paginated. Every filter combines with AND. A page may hold fewer than `limit` jobs — even none — and still carry a `next`; page on `next`. A deleted job (in the Trash) is never listed: read it with `GET /v1/trash`.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.string().optional().describe("Page size, 1–100 (default 50)."),
      cursor: z.string().optional().describe("The previous page's `next`."),
      status: z
        .string()
        .optional()
        .describe(`One or more of ${JOB_STATUSES.join(", ")} — comma-separated or repeated. An unknown status is a 400.`),
      type: z
        .string()
        .optional()
        .describe(`One or more \`input_data.type\` values (the route that created the job) — comma-separated or repeated, up to ${MAX_JOB_LIST_FILTER_VALUES}.`),
      origin: z.string().optional().describe("`input_data.origin` — the client app that sent the job."),
      source: z
        .string()
        .optional()
        .describe(`One or more surfaces that created the job (${JOB_SOURCES.join(", ")}) — comma-separated or repeated. An unknown one is a 400.`),
      favorited: z.enum(["true", "false"]).optional().describe("`true`: only jobs you favorited; `false`: only jobs you did not."),
      rating: z.enum(JOB_RATING_FILTERS).optional().describe("Your rating: `good`, `bad`, any (`rated`) or none (`unrated`)."),
      projectId: z
        .string()
        .optional()
        .describe("A project's id: the jobs a session of that project holds now. `none`: the jobs a session with no project holds. Each job once, however many sessions hold it. Not with `inSession=false`."),
      inSession: z
        .enum(["true", "false"])
        .optional()
        .describe("`false`: the jobs no session holds now (General), whatever session they were born in. `true`: the jobs at least one session holds."),
      withSessions: z
        .enum(["true", "false"])
        .optional()
        .describe("`true`: each job carries `sessions`, the sessions that hold it now (`id`, `title`, `projectId`)."),
    }),
  },
  responses: {
    200: {
      description: "A page of jobs",
      content: { "application/json": { schema: z.object({ data: z.array(JobSummary), next: z.string().nullable() }) } },
    },
    400: { description: "An unknown status, source, rating, favorited, projectId or inSession value, or projectId with inSession=false" },
    401: { description: "Unauthorized" },
    503: { description: "A rating filter on a server where ratings are not available yet" },
  },
})
