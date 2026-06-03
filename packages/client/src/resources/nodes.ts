import type { NodaroClient } from "../client.js"
import type { JobStatusResult } from "./jobs.js"
import { JobAbortedError, JobFailedError, JobTimeoutError } from "../errors.js"

export type NodeCategory =
  | "input"
  | "parameter"
  | "ai-image"
  | "ai-video"
  | "ai-audio"
  | "ai-text"
  | "processing"
  | "composition"
  | "trigger"
  | "output"
  | "control"
  | "entity"
  | "utility"

export type OutputType = "text" | "image" | "video" | "audio" | "data" | "none"

/**
 * Field shape inside a node's `inputSchema.fields[]`. Mirrors
 * `backend/src/lib/node-registry.ts`.
 */
export interface NodeInputField {
  key: string
  type: string
  required?: boolean
  options?: string[]
}

export interface NodeInputSchema {
  fields: NodeInputField[]
}

/**
 * Node descriptor returned by `GET /v1/nodes` and `GET /v1/nodes/:type`.
 * Mirrors `backend/src/lib/node-registry.ts#NodeDescriptor`.
 */
export interface NodeDescriptor {
  type: string
  label: string
  category: NodeCategory
  description: string
  outputType: OutputType
  /** Credit cost. Number when fixed, string range like "1-8" when model-dependent, undefined if free. */
  creditCost?: number | string
  /** Input fields the node exposes for user override (subset of full config). */
  inputSchema?: NodeInputSchema
  /** For AI nodes: list of provider IDs supported. */
  providers?: string[]
  /** Capability flags such as "supports-reference-image" or "supports-end-frame". */
  capabilities?: string[]
}

/**
 * Result of a direct node execution. Most node types return `{ jobId }` and
 * are processed asynchronously by a worker — the caller polls
 * `client.jobs.get(jobId)` until status is `completed`/`failed`.
 *
 * A small subset (combine-text, split-text, composite — the "inline"
 * orchestrator categories) execute synchronously and return their full
 * result body. The shape is route-specific; consumers should branch on the
 * presence of `jobId`.
 */
export type RunNodeResult =
  | { jobId: string; usageLogId?: string; [k: string]: unknown }
  | Record<string, unknown>

/**
 * The `output_data` shape a finalized generation job writes. Every async
 * generation node persists one (or more) of these media URLs to
 * `jobs.output_data` on completion — `generate-image` → `imageUrl`,
 * `generate-video` / `combine-videos` / `merge-video-audio` / `video-upscale`
 * → `videoUrl` (+ `thumbnailUrl`), `text-to-speech` / `generate-music` →
 * `audioUrl`. Resolved by {@link NodesResource.runAndWait}. Extra fields may be
 * present, so the index signature is open.
 */
export interface NodeJobOutput {
  /** `text-to-speech` / `generate-music` / audio nodes write here. */
  readonly audioUrl?: string
  /** `generate-video` / `combine-videos` / `merge-video-audio` / `video-upscale` write here. */
  readonly videoUrl?: string
  /** `generate-image` / `edit-image` / `extract-frame` write here. */
  readonly imageUrl?: string
  /** Poster frame for video outputs. */
  readonly thumbnailUrl?: string
  readonly [k: string]: unknown
}

/** Options for {@link NodesResource.runAndWait} and {@link NodesResource.runMany}. */
export interface RunAndWaitOptions {
  /**
   * Abort the run/poll loop. Aborting (or passing an already-aborted signal)
   * stops polling and rejects with {@link JobAbortedError}.
   */
  readonly signal?: AbortSignal
  /** Called with each lean status the poll loop observes (running → terminal). */
  readonly onProgress?: (status: JobStatusResult) => void
  /** Poll interval in ms. Default 2000. */
  readonly pollMs?: number
  /** Wall-clock cap before giving up, in ms. Default ~15 min (900_000). */
  readonly maxMs?: number
}

/** One settled result from {@link NodesResource.runMany}. */
export interface RunManyResult {
  readonly jobId: string
  readonly output: NodeJobOutput
}

// Terminal statuses (poll loop stops on these) are handled explicitly in
// `pollJob`: `completed` resolves output_data, `failed`/`cancelled` throw a
// JobFailedError — matching studio's `completed | failed | cancelled` set.
const DEFAULT_POLL_MS = 2000
/** Safety cap so a stuck job can't poll forever (~15 min at 2s). */
const DEFAULT_MAX_MS = 15 * 60 * 1000

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobAbortedError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new JobAbortedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })

/** Pull a `{ jobId }` off a run result, or throw a labelled JobFailedError. */
function extractJobId(result: RunNodeResult, label: string): string {
  if (result && typeof result === "object" && "jobId" in result) {
    const jobId = (result as { jobId: unknown }).jobId
    if (typeof jobId === "string") return jobId
  }
  // No jobId means the node ran inline/synchronously (combine-text, etc.) or
  // the route shape changed — runAndWait is for async jobs, so this is an error.
  throw new JobFailedError(`${label} did not return a jobId`, "")
}

export class NodesResource {
  constructor(private client: NodaroClient) {}

  /** List all known node descriptors. Server caches publicly for 5 minutes. */
  list(): Promise<{ data: NodeDescriptor[] }> {
    return this.client.request("GET", "/v1/nodes")
  }

  /** Get a single node descriptor by type slug (e.g. "generate-image"). */
  get(type: string): Promise<{ data: NodeDescriptor }> {
    return this.client.request("GET", `/v1/nodes/${encodeURIComponent(type)}`)
  }

  /**
   * Run a single node directly without wrapping it in a workflow. Posts
   * `params` as the request body to `POST /v1/<type>` (the route convention
   * every generation node follows: `generate-image`, `image-to-video`,
   * `text-to-speech`, etc.).
   *
   * This is the SDK equivalent of the MCP server's verb tools — and the
   * path the Nodaro CLI uses for `nodaro nodes run <type>`.
   *
   * Most node types are async: the response includes `{ jobId }` and the
   * actual generation runs on a worker. Poll `client.jobs.get(jobId)` until
   * completed. Inline node types (combine-text, etc.) return their full
   * result synchronously without a `jobId` field.
   *
   * @param type    Node type slug — must match an entry in the registry
   *                returned by `list()` (e.g. "generate-image").
   * @param params  Request body. Field names must match the node's
   *                `inputSchema` (see `get(type).inputSchema`).
   */
  run(type: string, params: Record<string, unknown> = {}): Promise<RunNodeResult> {
    return this.client.request("POST", `/v1/${encodeURIComponent(type)}`, { body: params })
  }

  /**
   * Run a single async node to completion: {@link run} it, extract the
   * `{ jobId }`, then client-poll `jobs.getStatus(jobId)` every `pollMs`
   * (default 2000) until a terminal status, up to `maxMs` (default ~15 min).
   *
   * Resolves the job's typed `output_data` ({@link NodeJobOutput}) on
   * `completed`. Throws (all typed, catchable by `instanceof`):
   * - {@link InsufficientCreditsError} / {@link StorageExceededError} etc. —
   *   surfaced by the underlying {@link run} on 402/413/… before any poll.
   * - {@link JobFailedError} — terminal `failed`/`cancelled` (carries the
   *   job's `error_message` + `jobId`).
   * - {@link JobTimeoutError} — `maxMs` deadline exceeded before terminal.
   * - {@link JobAbortedError} — `signal` fired (or was already aborted);
   *   polling stops immediately.
   *
   * Polling is fully client-side (no server function blocks) — the same model
   * thin clients use, lifted out of their hand-rolled run→poll loops.
   *
   * @param type    Node type slug (e.g. "generate-video"). See {@link run}.
   * @param params  Request body — field names match the node's `inputSchema`.
   * @param opts    `signal` / `onProgress` / `pollMs` / `maxMs`.
   */
  async runAndWait(
    type: string,
    params: Record<string, unknown> = {},
    opts: RunAndWaitOptions = {},
  ): Promise<NodeJobOutput> {
    if (opts.signal?.aborted) throw new JobAbortedError()
    const result = await this.run(type, params)
    const jobId = extractJobId(result, type)
    return this.pollJob(jobId, type, opts)
  }

  /**
   * Fan out N async runs of the same node `type` to completion concurrently —
   * the candidate-grid path (generate N stills/clips in parallel). Each runs
   * via {@link runAndWait}; resolves once ALL settle, to an array of
   * `{ jobId, output }` in input order. Rejects (and the rejection wins) if any
   * single run rejects — same typed errors as {@link runAndWait}. A shared
   * `signal` aborts the whole batch.
   *
   * @param type        Node type slug, applied to every entry.
   * @param paramsList  One request body per candidate.
   * @param opts        Shared `signal` / `onProgress` / `pollMs` / `maxMs`.
   */
  async runMany(
    type: string,
    paramsList: Record<string, unknown>[],
    opts: RunAndWaitOptions = {},
  ): Promise<RunManyResult[]> {
    if (opts.signal?.aborted) throw new JobAbortedError()
    return Promise.all(
      paramsList.map(async (params) => {
        if (opts.signal?.aborted) throw new JobAbortedError()
        const result = await this.run(type, params)
        const jobId = extractJobId(result, type)
        const output = await this.pollJob(jobId, type, opts)
        return { jobId, output }
      }),
    )
  }

  /** Poll an already-kicked job id until terminal; resolve output_data or throw. */
  private async pollJob(
    jobId: string,
    label: string,
    opts: RunAndWaitOptions,
  ): Promise<NodeJobOutput> {
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
    const maxMs = opts.maxMs ?? DEFAULT_MAX_MS
    const deadline = Date.now() + maxMs
    for (;;) {
      if (opts.signal?.aborted) throw new JobAbortedError(undefined, jobId)
      const { data } = await this.client.jobs.getStatus(jobId)
      opts.onProgress?.(data)
      if (data.status === "completed") {
        return (data.output_data ?? {}) as NodeJobOutput
      }
      if (data.status === "failed" || data.status === "cancelled") {
        throw new JobFailedError(
          data.error_message ?? `${label} ${data.status}`,
          jobId,
          data.status,
        )
      }
      if (Date.now() > deadline) {
        throw new JobTimeoutError(`${label} timed out`, jobId, maxMs)
      }
      await sleep(pollMs, opts.signal)
    }
  }
}
