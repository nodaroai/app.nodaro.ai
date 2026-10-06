/**
 * A saved canvas's run results, named by the jobs that made them — resolved
 * when a workflow is READ or SAVED through the server, never by a backfill
 * (decided 2026-10-05; it replaces the migration that rewrote `workflows.nodes`
 * in place and bumped `version` under an open editor).
 *
 * TWO things a saved result can be missing, both repaired here by ONE rule:
 *
 *   1. A placeholder job id. Before a server run published its rows' own
 *      identity, every lane that landed a server run's result on the canvas
 *      named it `exec-<node>` (the run's one take), `exec-<node>-<n>` (a fan-out
 *      row; `n` counts only the rows new to the node, so it never says which
 *      iteration made it) or `exec-<node>-v<N>` (variant N of one multi-output
 *      job). The editor autosaved those into `data.generatedResults`.
 *   2. An Apply EDL take landed before renders were labelled: a real job id and
 *      no `quality`, so no Preview label.
 *
 * THE MATCH IS EXACT AND UNIQUE, never positional. A placeholder is renamed
 * only when its URL is the output of exactly ONE completed job of the
 * workflow's owner (`jobs.user_id`) run for that node (`input_data.node_id`):
 *   exec-<node>, exec-<node>-<n>  the job's output URL (`jobOutputUrl`);
 *                                 `exec-<node>` may also be variant 0 of a
 *                                 multi-output job (`imageUrls[0]` / `audioUrls[0]`).
 *   exec-<node>-v<N>              `imageUrls[N]` or `audioUrls[N]`; it becomes
 *                                 `<job>-v<N>`, the id a live run gives it.
 * Two jobs with that URL, no such job, a placeholder naming another node (a
 * pasted copy), a result whose URL is not a non-empty string, a run started by
 * a collaborator (their job, not the owner's): all stay as they are. A render
 * take (Apply EDL) with a real id is labelled only when that id is a completed
 * render job of the owner whose output URL is the take's URL.
 *
 * WHAT A MATCH WRITES. The job id; and, matched by the job's own output URL,
 * the fields of `jobRowStamp` the result does not already hold — `thumbnailUrl`
 * for every type, and for a render `quality` (the worker's, else the order's:
 * "proxy" is a Preview) and `clipKey`. Migration 459 stamps a server run's rows
 * by the same rule, and `supabase/tests/fixtures/job-row-stamps.sql` holds both
 * implementations to the same cases. A variant keeps only its new id: the job's
 * thumbnail is its first output's.
 *
 * NOTHING IS WRITTEN ON A READ. A read hands back a patched copy; the editor
 * then holds the real ids and its next ordinary save persists them, so a
 * workflow's `version` and `updated_at` never move under an open editor. A
 * server SAVE resolves the nodes it is about to write.
 *
 * COST. None when the nodes hold no placeholder and no unlabelled render: the
 * scan is in memory. Otherwise ONE `jobs` query (owner + completed + those
 * nodes or those ids, `idx_jobs_user_id`), paged only past PostgREST's row cap,
 * selecting the few output fields the rule reads — never `output_data` whole.
 * A failed lookup never fails the read or the save: the nodes go out as stored.
 *
 * NOT TOUCHED: a document a server codec owns (Studio: the
 * `workflow_requires_compatible_writer` predicate, mirrored by
 * `needsPublicWorkflowProjection`). Its write guard refuses every other writer,
 * so a save that only renamed a result would be refused where the same save
 * unrenamed passes, and its results are not where these placeholders live.
 *
 * Every server read that hands workflow nodes to a client or an engine goes
 * through `resolveCanvasResultIds` or is exempt with a reason:
 * `__tests__/canvas-result-ids-sites.test.ts` fails the build otherwise.
 */
import { isRenderNodeType } from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { needsPublicWorkflowProjection } from "./public-workflow-projection.js"

// ---------------------------------------------------------------------------
// The job row, as the rule reads it
// ---------------------------------------------------------------------------

/** One job, reduced to the fields the rule reads, each as SQL's `->>` reads it
 *  (a JSON string as itself, any other JSON value as its text, absent as null). */
export interface JobFacts {
  readonly id: string
  readonly userId: string | null
  readonly status: string | null
  readonly jobType: string | null
  readonly nodeId: string | null
  /** The order's `input_data.quality` — what an Apply EDL render was asked for. */
  readonly inputQuality: string | null
  readonly imageUrl: string | null
  readonly videoUrl: string | null
  readonly audioUrl: string | null
  /** Save to Storage's typed `url`, read only when `type` names a medium. */
  readonly url: string | null
  readonly type: string | null
  readonly thumbnailUrl: string | null
  /** What the worker wrote; for an Apply EDL render, "proxy" or "final". */
  readonly quality: string | null
  readonly clipKey: string | null
  readonly imageUrls: ReadonlyArray<string | null> | null
  readonly audioUrls: ReadonlyArray<string | null> | null
}

/** The PostgREST projection behind `JobFacts` (aliases → `jobFactsFromSelect`). */
export const JOB_FACTS_SELECT = [
  "id",
  "user_id",
  "status",
  "job_type",
  "node_id:input_data->>node_id",
  "input_quality:input_data->>quality",
  "image_url:output_data->>imageUrl",
  "video_url:output_data->>videoUrl",
  "audio_url:output_data->>audioUrl",
  "out_url:output_data->>url",
  "out_type:output_data->>type",
  "thumbnail_url:output_data->>thumbnailUrl",
  "out_quality:output_data->>quality",
  "clip_key:output_data->>clipKey",
  "image_urls:output_data->imageUrls",
  "audio_urls:output_data->audioUrls",
].join(", ")

/** A JSON value as SQL's `->>` / `jsonb_array_elements_text` yields it. */
function sqlText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

/** `jsonb_array_elements_text` over an array value; null for anything else. */
function sqlTextArray(value: unknown): ReadonlyArray<string | null> | null {
  return Array.isArray(value) ? value.map(sqlText) : null
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** A row of `JOB_FACTS_SELECT` as PostgREST returns it. */
export function jobFactsFromSelect(row: Record<string, unknown>): JobFacts {
  return {
    id: String(row.id),
    userId: sqlText(row.user_id),
    status: sqlText(row.status),
    jobType: sqlText(row.job_type),
    nodeId: sqlText(row.node_id),
    inputQuality: sqlText(row.input_quality),
    imageUrl: sqlText(row.image_url),
    videoUrl: sqlText(row.video_url),
    audioUrl: sqlText(row.audio_url),
    url: sqlText(row.out_url),
    type: sqlText(row.out_type),
    thumbnailUrl: sqlText(row.thumbnail_url),
    quality: sqlText(row.out_quality),
    clipKey: sqlText(row.clip_key),
    imageUrls: sqlTextArray(row.image_urls),
    audioUrls: sqlTextArray(row.audio_urls),
  }
}

/** A whole `jobs` row (its `input_data` / `output_data` objects) as the
 *  projection would return it — for fixtures and callers that hold the row. */
export function jobFactsFromRow(row: {
  readonly id: string
  readonly user_id?: unknown
  readonly status?: unknown
  readonly job_type?: unknown
  readonly input_data?: unknown
  readonly output_data?: unknown
}): JobFacts {
  const input = obj(row.input_data)
  const output = obj(row.output_data)
  return jobFactsFromSelect({
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    job_type: row.job_type,
    node_id: input.node_id,
    input_quality: input.quality,
    image_url: output.imageUrl,
    video_url: output.videoUrl,
    audio_url: output.audioUrl,
    out_url: output.url,
    out_type: output.type,
    thumbnail_url: output.thumbnailUrl,
    out_quality: output.quality,
    clip_key: output.clipKey,
    image_urls: output.imageUrls,
    audio_urls: output.audioUrls,
  })
}

const nonEmpty = (s: string | null | undefined): string | undefined => (s ? s : undefined)

/**
 * A job's output URL, as the orchestrator put it in a run's row (migration 459
 * `mig459_job_url`): `imageUrl`, else `videoUrl`, else `audioUrl` — an empty
 * string is absent — else Save to Storage's `url` when its `type` names a medium.
 */
export function jobOutputUrl(job: JobFacts): string | undefined {
  return nonEmpty(job.imageUrl)
    ?? nonEmpty(job.videoUrl)
    ?? nonEmpty(job.audioUrl)
    ?? (job.type === "image" || job.type === "video" || job.type === "audio" ? nonEmpty(job.url) : undefined)
}

/** What a result made by `job` is stamped with (migration 459 `mig459_stamp`). */
export interface JobRowStamp {
  readonly jobId: string
  readonly thumbnailUrl?: string
  readonly quality?: string
  readonly clipKey?: string
}

/**
 * The stamp of a result `job` made: its id and thumbnail for every type; for an
 * render (RENDER_NODE_TYPES), also its `quality` — the worker's, else the order's by the
 * worker's own rule ("proxy" is a Preview, anything else the final) — and its
 * `clipKey` when it had one. Another node's `quality` is something else.
 */
export function jobRowStamp(job: JobFacts): JobRowStamp {
  const render = isRenderNodeType(job.jobType)
  const thumbnailUrl = nonEmpty(job.thumbnailUrl)
  const quality = render ? (nonEmpty(job.quality) ?? (job.inputQuality === "proxy" ? "proxy" : "final")) : undefined
  const clipKey = render ? nonEmpty(job.clipKey) : undefined
  return {
    jobId: job.id,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(quality ? { quality } : {}),
    ...(clipKey ? { clipKey } : {}),
  }
}

// ---------------------------------------------------------------------------
// What a saved canvas asks for
// ---------------------------------------------------------------------------

export type Placeholder =
  | { readonly kind: "take" }
  | { readonly kind: "row" }
  | { readonly kind: "variant"; readonly variant: number }

/** A placeholder job id, parsed relative to its OWN node's id; null for any
 *  other id (a real one, or a placeholder naming another node). */
export function parsePlaceholder(nodeId: string, jobId: string): Placeholder | null {
  const base = `exec-${nodeId}`
  if (jobId === base) return { kind: "take" }
  if (!jobId.startsWith(base)) return null
  const suffix = jobId.slice(base.length)
  if (/^-[0-9]+$/.test(suffix)) return { kind: "row" }
  const variant = /^-v([1-9][0-9]{0,5})$/.exec(suffix)
  return variant ? { kind: "variant", variant: Number(variant[1]) } : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RENDER_QUALITIES: ReadonlySet<unknown> = new Set(["proxy", "final"])

type Entry = Record<string, unknown>
type NodeLike = { readonly id?: unknown; readonly type?: unknown; readonly data?: unknown }

function resultsOf(node: unknown): readonly unknown[] | undefined {
  const results = obj(obj(node).data).generatedResults
  return Array.isArray(results) ? results : undefined
}

/** An Apply EDL take landed before renders were labelled: a real job id, a
 *  URL, and no render quality. */
function isUnlabelledRender(node: NodeLike, entry: Entry): boolean {
  return isRenderNodeType(node.type)
    && typeof entry.jobId === "string" && UUID.test(entry.jobId)
    && typeof entry.url === "string" && entry.url.length > 0
    && !RENDER_QUALITIES.has(entry.quality)
}

/** What the nodes ask the jobs table for: the nodes holding a placeholder, and
 *  the ids of unlabelled renders. Both empty = nothing to resolve, no query. */
export interface CanvasResultQuery {
  readonly nodeIds: readonly string[]
  readonly jobIds: readonly string[]
}

export function scanCanvasResults(nodes: unknown): CanvasResultQuery {
  const nodeIds = new Set<string>()
  const jobIds = new Set<string>()
  if (!Array.isArray(nodes)) return { nodeIds: [], jobIds: [] }
  for (const raw of nodes) {
    const node = obj(raw) as NodeLike
    if (typeof node.id !== "string") continue
    for (const r of resultsOf(node) ?? []) {
      const entry = obj(r)
      if (typeof entry.jobId !== "string" || typeof entry.url !== "string" || entry.url.length === 0) continue
      if (parsePlaceholder(node.id, entry.jobId)) nodeIds.add(node.id)
      else if (isUnlabelledRender(node, entry)) jobIds.add(entry.jobId)
    }
  }
  return { nodeIds: [...nodeIds], jobIds: [...jobIds] }
}

// ---------------------------------------------------------------------------
// The rule, pure
// ---------------------------------------------------------------------------

/** The fields of `stamp` a result lacks, beside its own (never overwriting). */
function withStampFill(entry: Entry, stamp: JobRowStamp): Entry {
  const fill: Entry = {}
  if (stamp.thumbnailUrl && !(typeof entry.thumbnailUrl === "string" && entry.thumbnailUrl)) fill.thumbnailUrl = stamp.thumbnailUrl
  if (stamp.quality && !RENDER_QUALITIES.has(entry.quality)) fill.quality = stamp.quality
  if (stamp.clipKey && !(typeof entry.clipKey === "string" && entry.clipKey)) fill.clipKey = stamp.clipKey
  return fill
}

/**
 * The nodes with every result the rule names exactly, renamed and stamped.
 * Pure. The SAME array comes back when nothing matched, so a caller can tell a
 * no-op apart; a changed node is a copy, never an edit of the input.
 */
export function applyCanvasResultIds<T>(nodes: T, ownerUserId: string, jobs: readonly JobFacts[]): T {
  if (!Array.isArray(nodes)) return nodes
  const mine = jobs.filter((j) => j.userId === ownerUserId && j.status === "completed")
  // (node, url) → the jobs whose output URL it is; (node, slot, url) → the jobs
  // whose variant `slot` it is. Sets of ids: two jobs = ambiguous = no match.
  const primary = new Map<string, Map<string, JobFacts>>()
  const variants = new Map<string, Set<string>>()
  const byId = new Map<string, JobFacts>()
  const key = (...parts: Array<string | number>) => JSON.stringify(parts)
  for (const job of mine) {
    byId.set(job.id, job)
    if (job.nodeId === null) continue
    const url = jobOutputUrl(job)
    if (url) {
      const k = key(job.nodeId, url)
      const at = primary.get(k) ?? new Map<string, JobFacts>()
      at.set(job.id, job)
      primary.set(k, at)
    }
    for (const list of [job.imageUrls, job.audioUrls]) {
      list?.forEach((u, slot) => {
        if (u === null) return
        const k = key(job.nodeId as string, slot, u)
        const at = variants.get(k) ?? new Set<string>()
        at.add(job.id)
        variants.set(k, at)
      })
    }
  }

  let changed = false
  const out = (nodes as unknown[]).map((raw) => {
    const node = obj(raw) as NodeLike
    const results = resultsOf(node)
    if (typeof node.id !== "string" || !results) return raw
    const nodeId = node.id
    let nodeChanged = false
    const next = results.map((r) => {
      const entry = obj(r)
      if (r !== entry || typeof entry.jobId !== "string" || typeof entry.url !== "string" || entry.url.length === 0) return r
      const url = entry.url
      const placeholder = parsePlaceholder(nodeId, entry.jobId)
      let renamed: Entry | undefined
      if (placeholder) {
        const byUrl = primary.get(key(nodeId, url))
        if (placeholder.kind === "variant") {
          const ids = variants.get(key(nodeId, placeholder.variant, url))
          if (ids?.size === 1) renamed = { ...entry, jobId: `${[...ids][0]}-v${placeholder.variant}` }
        } else {
          const ids = new Set(byUrl?.keys() ?? [])
          if (placeholder.kind === "take") variants.get(key(nodeId, 0, url))?.forEach((id) => ids.add(id))
          if (ids.size === 1) {
            const id = [...ids][0]
            const viaOutput = byUrl?.get(id)
            renamed = { ...entry, jobId: id, ...(viaOutput ? withStampFill(entry, jobRowStamp(viaOutput)) : {}) }
          }
        }
      } else if (isUnlabelledRender(node, entry)) {
        const job = byId.get(entry.jobId)
        if (job && isRenderNodeType(job.jobType) && jobOutputUrl(job) === url) {
          const fill = withStampFill(entry, jobRowStamp(job))
          if (Object.keys(fill).length > 0) renamed = { ...entry, ...fill }
        }
      }
      if (!renamed) return r
      nodeChanged = true
      return renamed
    })
    if (!nodeChanged) return raw
    changed = true
    return { ...node, data: { ...obj(node.data), generatedResults: next } }
  })
  return (changed ? out : nodes) as T
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

/** Every completed job of `owner` behind `query`. Injected in tests. */
export type FetchJobFacts = (owner: string, query: CanvasResultQuery) => Promise<readonly JobFacts[]>

/** PostgREST's row cap on one response; a full page asks for the next. */
const PAGE = 1000

/** A value inside a PostgREST `in.(...)` list, quoted so a comma, parenthesis
 *  or quote in a node id cannot end the list. */
function listValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export const fetchJobFacts: FetchJobFacts = async (owner, query) => {
  const clauses: string[] = []
  if (query.nodeIds.length > 0) clauses.push(`input_data->>node_id.in.(${query.nodeIds.map(listValue).join(",")})`)
  if (query.jobIds.length > 0) clauses.push(`id.in.(${query.jobIds.map(listValue).join(",")})`)
  if (clauses.length === 0) return []
  const facts: JobFacts[] = []
  // Paged, never truncated: a match is "exactly one job", so a second job cut
  // off by the row cap would turn an ambiguous URL into a false match.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_FACTS_SELECT)
      .eq("user_id", owner)
      .eq("status", "completed")
      .or(clauses.join(","))
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`canvas result ids: ${error.message}`)
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
    for (const row of rows) facts.push(jobFactsFromSelect(row))
    if (rows.length < PAGE) return facts
  }
}

export interface ResolveOptions {
  /** The workflow's `settings`, when the caller has them: half of what makes a
   *  document codec-owned. Without them only the nodes are asked. */
  readonly settings?: unknown
  readonly fetchJobs?: FetchJobFacts
}

/**
 * `nodes` with every placeholder id and unlabelled render the rule names
 * exactly, resolved — the SAME array when there was nothing to resolve, the
 * owner is unknown, the document is codec-owned, or the lookup failed.
 */
export async function resolveCanvasResultIds<T>(nodes: T, ownerUserId: unknown, opts: ResolveOptions = {}): Promise<T> {
  if (!Array.isArray(nodes) || typeof ownerUserId !== "string" || ownerUserId.length === 0) return nodes
  const query = scanCanvasResults(nodes)
  if (query.nodeIds.length === 0 && query.jobIds.length === 0) return nodes
  if (isCodecOwnedDocument(nodes, opts.settings)) return nodes
  let jobs: readonly JobFacts[]
  try {
    jobs = await (opts.fetchJobs ?? fetchJobFacts)(ownerUserId, query)
  } catch {
    // A read or a save never fails over a label: the nodes go out as stored.
    return nodes
  }
  return applyCanvasResultIds(nodes, ownerUserId, jobs)
}

/** A workflow row with its `nodes` resolved (by its own `user_id` and
 *  `settings`) — the SAME row when nothing changed, a copy otherwise. A row
 *  read without its `settings` column is left as it is: whether a document is
 *  codec-owned is never judged on its nodes alone (a selected, empty
 *  `settings` is an answer; an unselected one is not). */
export async function withResolvedResultIds<R extends Record<string, unknown>>(
  row: R,
  opts: Omit<ResolveOptions, "settings"> & { readonly ownerUserId?: string } = {},
): Promise<R> {
  if (!Array.isArray(row.nodes) || !("settings" in row)) return row
  const nodes = await resolveCanvasResultIds(row.nodes, opts.ownerUserId ?? row.user_id, {
    settings: row.settings,
    ...(opts.fetchJobs ? { fetchJobs: opts.fetchJobs } : {}),
  })
  return nodes === row.nodes ? row : { ...row, nodes }
}

/** Whether a document is one a server codec owns (Studio): the TS mirror of
 *  `workflow_requires_compatible_writer` (migration 398). */
export function isCodecOwnedDocument(nodes: unknown, settings: unknown): boolean {
  return needsPublicWorkflowProjection({
    id: "",
    name: "",
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: [],
    settings: obj(settings),
  })
}
