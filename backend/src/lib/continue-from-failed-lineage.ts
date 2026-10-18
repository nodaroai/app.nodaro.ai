/**
 * The lineage of a saved workflow's continue-from-failed runs (decided
 * 2026-10-17; building on the newest, 2026-10-18).
 *
 * A failed run of a saved workflow can be continued from where it stopped
 * (`continueMode: "from-failed"` on `POST /v1/workflows/:id/run`), and a
 * continuation that fails can be continued in turn. Each generation's
 * `node_states` carry the completed states seeded from the one it was built
 * on, so the NEWEST generation holds all the progress: continuing from an
 * older one would only run (and bill) again what a later generation already
 * did. So a continuation of any run of a lineage is decided by the lineage's
 * NEWEST generation (by `created_at`, of those that started and ended
 * `failed` or `completed`):
 * - it FAILED (and is not the run asked for): that one is continued instead
 *   (the use-case lane's rule, `lib/use-case/continuation.ts`) — refused,
 *   naming it;
 * - it COMPLETED having run ALL that its source left (`all` on its stamp):
 *   the work is done, and its results are on that run — refused, naming it;
 * - it COMPLETED by stopping at a Preview review — of an Apply EDL render, or
 *   of a use-case node with review on (Tighten Episode); its stamp names them,
 *   `previewRenders` and `reviewHolds`: continuing would only stop at the same
 *   Preview again, so it is refused, naming that run and what holds it — the
 *   next step is the run that finishes them (`heldFinalRun`, the renders at
 *   Final and the use-case nodes continuing their Preview's run), continuing
 *   that run, which joins the lineage (below);
 * - it COMPLETED only PART of what was left otherwise (a narrow `nodeIds`):
 *   the run asked for is continued, BUILT ON that generation — seeded from its
 *   states, which hold the earlier ones' too, and running only what it left;
 * - there is none, or it is the run asked for: that run is continued.
 *
 * Every continue-from-failed execution is stamped at insert with the run it
 * was asked to continue, the lineage's first run, the run its states were
 * seeded from, and whether the set it runs is the whole of what that run left
 * (`workflow_executions.trigger_data.continueFromFailed = { from, root,
 * seededFrom, all }`), so the later generations of a run are found by its
 * root. `seededFrom` and `all` are decided once, by the route, from the same
 * source and set it sends the orchestrator. No migration: the column exists,
 * and its other readers look only at their own keys (`appRun`,
 * `appRenderFinal`).
 *
 * A SUBSET continuation (`continueFromExecutionId` without a mode: a Render
 * final, or a run of named nodes) of a generation joins the lineage too —
 * stamped `via: "subset"`, `from` = `seededFrom` = that generation (it
 * completed) — but only of the lineage's NEWEST generation: every generation
 * is then built on the one before it, so the newest still holds all the
 * progress. One of an older generation stays outside the lineage. Its `all`:
 * the generation it continues ran all that was left (its own `all`), or this
 * run takes on every node that generation did not complete — and, either way,
 * it stops at no Preview and leaves none of that generation's holds standing
 * (decided 2026-10-18). A hold of that generation this run does not execute
 * is carried onto its stamp, so the newest still names every Preview waiting
 * for its final. So a Render final of a run whose only stop was its Preview
 * ends the lineage, and one that leaves anything is built on.
 *
 * A lineage has a NODE SCOPE: what its root was started on. A run started on
 * named nodes (`nodeIds`: the editor's Run selected, an API subset, a Render
 * final) that is no generation records them (`trigger_data.nodeSelection`);
 * every generation carries its root's on its stamp (`scope`), whatever
 * `nodeIds` that hop was sent. A continue-from-failed sent no `nodeIds`
 * considers the scope PLUS what the run it continues left unfinished — every
 * node that failed there, and those its failure held back (`leftUnfinishedBy`)
 * — so a failure outside the scope (in a wider hop, or the run in `next`) is
 * always retried; "all that was left" (`all`) is judged against that same
 * set. No scope (a root started on every node, or one from before the
 * selection was recorded): every node, as before. Explicit `nodeIds` always
 * win: a chain whose newest generation is done (judged against its default
 * set) is still built on when a node they name is left there.
 *
 * Only a run a stamp-writing lane started carries a scope (`serverTriggerData`,
 * lib/server-started-runs.ts): a webhook, schedule or other trigger lane
 * stores its caller's payload in `trigger_data`, so a `nodeSelection` or stamp
 * `scope` there is never read.
 *
 * A generation counts only once it STARTED (`started_at` is written with the
 * seeded states when the run flips to running): one refused before that (a
 * preview gate, a preflight) holds no states, and sending a caller there would
 * run everything again. Cancelled generations do not count; one still under
 * way is the run route's `already_running`.
 *
 * A stamp is the platform's only on a run the run route started (`manual`,
 * `mcp`; lib/server-started-runs.ts): the lineage read finds generations only
 * among those, and a stamp on any other row (a webhook's, whose body a caller
 * wrote) reads as none.
 */
import { onlyServerStampedRows, serverTriggerData } from "./server-started-runs.js"
import { supabase } from "./supabase.js"

const STAMP_KEY = "continueFromFailed"

/** The `trigger_data` key a continue-from-failed is stamped under (reserved: never caller data, lib/trigger-data-stamps.ts). */
export const CONTINUE_FROM_FAILED_STAMP_KEY = STAMP_KEY

export interface ContinueFromFailedStamp {
  /** The execution this one was asked to continue (it had ended `failed`). */
  readonly from: string
  /** The lineage's first run: the run no continue-from-failed made. */
  readonly root: string
  /**
   * The execution its states were seeded from: `from`, or the newest
   * generation of the lineage, which completed part of what was left. Absent
   * on a stamp written before the field existed (it was `from`).
   */
  readonly seededFrom?: string
  /**
   * The set this one runs is everything `seededFrom` left (not a narrow
   * `nodeIds`, and no stop at a Preview review): once it completes, nothing
   * of the lineage is left to continue. `false` on a stamp written before
   * the field existed.
   */
  readonly all: boolean
  /**
   * `"subset"`: a subset continuation (a Render final, or a run of named
   * nodes) of `from`, a COMPLETED generation of the lineage. Absent: a
   * continue-from-failed — `from` ended `failed`.
   */
  readonly via?: "subset"
  /**
   * The Apply EDL renders this run stops at for a Preview review (it renders
   * them at Preview, or hands a Preview of them on), decided at insert by the
   * stop rule the orchestrator asks. Absent: it stops at none (or a stamp
   * from before the field). A subset continuation also lists the renders of
   * the generation it continues that it does not execute (still held there).
   */
  readonly previewRenders?: readonly string[]
  /**
   * The use-case nodes with review on (Tighten Episode) this run stops at for
   * their Preview review, decided as `previewRenders` is, and carried the same
   * way. Absent: none (or a stamp from before the field).
   */
  readonly reviewHolds?: readonly string[]
  /**
   * The lineage's node scope: the nodes its root was started on (the root's
   * `nodeSelection`, below), carried unchanged from generation to generation —
   * never a hop's own `nodeIds`. A continue-from-failed with no `nodeIds`
   * considers these and what the run it continues left unfinished, and `all`
   * is judged against that set. Absent: the root was
   * started on every node (or before the selection was recorded).
   */
  readonly scope?: readonly string[]
}

/** The `trigger_data` a continue-from-failed execution is created with. */
export function continueFromFailedStamp(stamp: ContinueFromFailedStamp): { continueFromFailed: ContinueFromFailedStamp } {
  return {
    [STAMP_KEY]: {
      from: stamp.from,
      root: stamp.root,
      ...(stamp.seededFrom ? { seededFrom: stamp.seededFrom } : {}),
      all: stamp.all === true,
      ...(stamp.via === "subset" ? { via: "subset" } : {}),
      ...(stamp.previewRenders && stamp.previewRenders.length > 0 ? { previewRenders: [...stamp.previewRenders] } : {}),
      ...(stamp.reviewHolds && stamp.reviewHolds.length > 0 ? { reviewHolds: [...stamp.reviewHolds] } : {}),
      ...(stamp.scope && stamp.scope.length > 0 ? { scope: [...stamp.scope] } : {}),
    },
  } as { continueFromFailed: ContinueFromFailedStamp }
}

const SELECTION_KEY = "nodeSelection"

/**
 * The `trigger_data` of a run started on named nodes (`nodeIds` on
 * `POST /v1/workflows/:id/run` — the editor's Run selected, an API subset, a
 * Render final) that is no generation of a lineage: the nodes it was started
 * on, each once, in the order sent. A later continue-from-failed of the run
 * considers these by default (`lineageScopeOf`), with what it left
 * unfinished (`leftUnfinishedBy`). `{}` for none.
 */
export function nodeSelectionData(nodeIds: readonly string[]): { nodeSelection?: string[] } {
  const ids = [...new Set(nodeIds.filter((id) => typeof id === "string" && id.length > 0))]
  return ids.length > 0 ? { [SELECTION_KEY]: ids } : {}
}

// The nodes a run left unfinished: failed, held back, or handed on unfinished
// (`carriedUnfinished`) — the rule the editor predicts by too.
export { leftUnfinishedBy } from "@nodaro/render-rules"

/** The node selection a `trigger_data` value records, or `null` when it records none. */
export function nodeSelectionOf(triggerData: unknown): string[] | null {
  if (typeof triggerData !== "object" || triggerData === null || Array.isArray(triggerData)) return null
  const raw = (triggerData as Record<string, unknown>)[SELECTION_KEY]
  if (!Array.isArray(raw)) return null
  const ids = raw.filter((id): id is string => typeof id === "string" && id.length > 0)
  return ids.length > 0 ? ids : null
}

/**
 * The node scope of `source`'s lineage: what a continue-from-failed of it
 * considers when sent no `nodeIds` (with what the run left unfinished,
 * `leftUnfinishedBy`), and what "all that was left" is judged against with
 * it. Read from a row only when a stamp-writing lane started it
 * (`serverTriggerData`, in the loader). A generation of a lineage carries its root's (`stamp.scope`) —
 * never its own selection, so a narrow hop or Render final in the chain does
 * not narrow it. A run of no lineage is its own root: its `nodeSelection`.
 * `null`: every node (the root was started on every node, or recorded none —
 * a run from before the selection was recorded). Pure.
 */
export function lineageScopeOf(source: {
  readonly continueFromFailed?: ContinueFromFailedStamp | null
  readonly nodeSelection?: readonly string[] | null
}): readonly string[] | null {
  if (source.continueFromFailed) return source.continueFromFailed.scope ?? null
  return source.nodeSelection && source.nodeSelection.length > 0 ? source.nodeSelection : null
}

/**
 * The node scope of a stored `workflow_executions` row (`lineageScopeOf`),
 * read only on a run a stamp-writing lane started (`serverTriggerData`): what a
 * continue-from-failed of it sent no `nodeIds` considers, besides what it
 * left unfinished. The detail read hands it on (`nodeScope`), so the editor's
 * Continue from failed predicts the set the server runs. `null`: every node.
 * Pure.
 */
export function nodeScopeOfRow(row: { readonly trigger_type?: unknown; readonly trigger_data?: unknown }): readonly string[] | null {
  return lineageScopeOf({
    continueFromFailed: continueFromFailedStampOf(serverTriggerData(row)),
    nodeSelection: nodeSelectionOf(serverTriggerData(row)),
  })
}

/** The stamp a `trigger_data` value holds, or `null` when it holds none. */
export function continueFromFailedStampOf(triggerData: unknown): ContinueFromFailedStamp | null {
  if (typeof triggerData !== "object" || triggerData === null || Array.isArray(triggerData)) return null
  const stamp = (triggerData as Record<string, unknown>)[STAMP_KEY]
  if (typeof stamp !== "object" || stamp === null || Array.isArray(stamp)) return null
  const { from, root, seededFrom, all, via, previewRenders, reviewHolds, scope } = stamp as Record<string, unknown>
  if (!(typeof from === "string" && from.length > 0 && typeof root === "string" && root.length > 0)) return null
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [])
  const renders = ids(previewRenders)
  const reviews = ids(reviewHolds)
  const scoped = ids(scope)
  return {
    from,
    root,
    ...(typeof seededFrom === "string" && seededFrom.length > 0 ? { seededFrom } : {}),
    all: all === true,
    ...(via === "subset" ? { via: "subset" as const } : {}),
    ...(renders.length > 0 ? { previewRenders: renders } : {}),
    ...(reviews.length > 0 ? { reviewHolds: reviews } : {}),
    ...(scoped.length > 0 ? { scope: scoped } : {}),
  }
}

/**
 * The holds of `head` (a generation a subset continuation continues) that the
 * continuation leaves standing: those it does not execute. One it executes is
 * either finished there (a render at Final, a use-case node continuing its
 * Preview's run) or held again, which its own stop rule names. Pure.
 */
export function carriedHolds(
  head: Pick<ContinueFromFailedStamp, "previewRenders" | "reviewHolds"> | null | undefined,
  runs: ReadonlySet<string>,
): { readonly previewRenders: string[]; readonly reviewHolds: string[] } {
  return {
    previewRenders: (head?.previewRenders ?? []).filter((id) => !runs.has(id)),
    reviewHolds: (head?.reviewHolds ?? []).filter((id) => !runs.has(id)),
  }
}

/** The lineage a continuation of `source` joins: the source's own root, or the source itself. */
export function lineageRootOf(source: { readonly id: string; readonly continueFromFailed?: ContinueFromFailedStamp | null }): string {
  return source.continueFromFailed?.root ?? source.id
}

/** A generation of a lineage, as the lineage read returns it. */
export interface Generation {
  readonly id: string
  /** `failed` or `completed`. */
  readonly status: string
  /** It ran all its source left (its stamp's `all`). */
  readonly all: boolean
  /** The Apply EDL renders it stopped at for a Preview review (its stamp's `previewRenders`); empty: none. */
  readonly previewRenders: readonly string[]
  /** The use-case nodes it stopped at for their review (its stamp's `reviewHolds`); empty: none. */
  readonly reviewHolds: readonly string[]
}

/**
 * The NEWEST generation of the lineage `root` — by `created_at`, of the
 * caller's own runs of this workflow that STARTED and ended `failed` or
 * `completed`, started by a lane that writes stamps — or `null` when there
 * is none. Throws on a read error (never
 * read as "none").
 */
export async function newestGeneration(input: {
  readonly userId: string
  readonly workflowId: string
  readonly root: string
}): Promise<Generation | null> {
  const { data, error } = await onlyServerStampedRows(
    supabase
      .from("workflow_executions")
      .select("id, status, trigger_type, trigger_data")
      .eq("user_id", input.userId)
      .eq("workflow_id", input.workflowId)
      .eq(`trigger_data->${STAMP_KEY}->>root`, input.root),
  )
    .in("status", ["failed", "completed"])
    .not("started_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`continue-from-failed: later continuations unreadable: ${error.message}`)
  const row = data as { id?: unknown; status?: unknown; trigger_type?: unknown; trigger_data?: unknown } | null
  if (!row || typeof row.id !== "string") return null
  const stamp = continueFromFailedStampOf(serverTriggerData(row))
  return {
    id: row.id,
    status: String(row.status),
    all: stamp?.all === true,
    previewRenders: stamp?.previewRenders ?? [],
    reviewHolds: stamp?.reviewHolds ?? [],
  }
}

/**
 * Does a SUBSET continuation of `source` (a Render final, or a run of named
 * nodes) join `source`'s lineage? Only when `source` is a generation of one
 * (it carries a stamp) and its NEWEST — else the lineage's newest generation
 * would no longer hold all its progress. Throws on a read error.
 */
export async function subsetJoinsLineage(
  source: { readonly id: string; readonly continueFromFailed?: ContinueFromFailedStamp | null },
  scope: { readonly userId: string; readonly workflowId: string },
): Promise<boolean> {
  if (!source.continueFromFailed) return false
  const newest = await newestGeneration({ ...scope, root: source.continueFromFailed.root })
  return newest?.id === source.id
}

/** Why a continue-from-failed of a run goes to another run instead. */
export interface SupersedingRun {
  readonly executionId: string
  /** `failed`: continue that one. `completed`: the work is done; its results are there. */
  readonly status: string
  /** The run itself is a continuation that never started: it holds nothing. */
  readonly neverStarted: boolean
}

/**
 * Where a continue-from-failed of `source` stands in its lineage: it is
 * refused in favour of another run (`superseded`), or because the lineage's
 * newest generation stopped at a Preview review and its final comes first
 * (`preview-pending`: `at` is that run, `renderNodeIds` the Apply EDL renders
 * and `reviewNodeIds` the review-on use-case nodes holding it), or
 * it runs, seeded from `seedFrom` — `source` itself, or the lineage's newest
 * generation, which completed part of what was left.
 */
export type ContinuationPoint =
  | { readonly kind: "superseded"; readonly by: SupersedingRun }
  | {
      readonly kind: "preview-pending"
      readonly at: string
      readonly renderNodeIds: readonly string[]
      readonly reviewNodeIds: readonly string[]
    }
  | { readonly kind: "continue"; readonly seedFrom: string }

/**
 * Where a continue-from-failed of `source` goes (the rule above). A
 * continuation that never started holds no states, so it is never continued
 * itself: it goes to its lineage's newest generation when that failed or
 * completed all (or to its Render final, when it stopped at a Preview), else
 * to a run that ended `failed` — the one it continued from its failure, or
 * for a subset continuation (whose `from` completed) the lineage's root, the
 * run its first continuation was made of — which a continuation then builds
 * on the newest from. Throws on a read error.
 */
export async function continuationPointOf(
  source: {
    readonly id: string
    readonly startedAt?: string | null
    readonly continueFromFailed?: ContinueFromFailedStamp | null
  },
  scope: { readonly userId: string; readonly workflowId: string },
): Promise<ContinuationPoint> {
  const newest = await newestGeneration({ ...scope, root: lineageRootOf(source) })
  const partial = newest !== null && newest.status === "completed" && !newest.all
  // A completed newest generation that stopped at a Preview review: its final first.
  const pending: ContinuationPoint | null =
    partial && (newest.previewRenders.length > 0 || newest.reviewHolds.length > 0)
      ? { kind: "preview-pending", at: newest.id, renderNodeIds: newest.previewRenders, reviewNodeIds: newest.reviewHolds }
      : null
  const stamp = source.continueFromFailed
  if (stamp && !source.startedAt) {
    // `newest` is never `source` here: it counts only runs that started.
    if (pending) return pending
    return {
      kind: "superseded",
      by:
        newest && !partial
          ? { executionId: newest.id, status: newest.status, neverStarted: true }
          : { executionId: stamp.via === "subset" ? stamp.root : stamp.from, status: "failed", neverStarted: true },
    }
  }
  if (!newest || newest.id === source.id) return { kind: "continue", seedFrom: source.id }
  if (pending) return pending
  if (partial) return { kind: "continue", seedFrom: newest.id }
  return { kind: "superseded", by: { executionId: newest.id, status: newest.status, neverStarted: false } }
}

/**
 * The run a continue-from-failed of `source` goes to instead
 * (`continuationPointOf`), or `null` when `source` is the one to continue —
 * built on its lineage's newest generation or not — or its newest stopped at a
 * Preview (`continuationPointOf` says so). Throws on a read error.
 */
export async function supersedingRunOf(
  source: Parameters<typeof continuationPointOf>[0],
  scope: Parameters<typeof continuationPointOf>[1],
): Promise<SupersedingRun | null> {
  const point = await continuationPointOf(source, scope)
  return point.kind === "superseded" ? point.by : null
}

/**
 * The message of `continuation_preview_pending`: the lineage's newest
 * generation `at` stopped at a Preview review of `renderNodeIds` (Apply EDL
 * renders) and `reviewNodeIds` (use-case nodes with review on), so the next
 * step is the run that finishes them. A single render: its Render final
 * (`renderFinal`). Anything else is ONE run continuing `at`
 * (`heldFinalRun`, sent with the refusal as `next`): `renderFinal` takes one
 * render, two Previews feeding one node cannot be finished one at a time, and
 * a use-case node has no `renderFinal` on `/run`.
 */
export function previewPendingMessage(
  at: string,
  renderNodeIds: readonly string[],
  reviewNodeIds: readonly string[] = [],
  /** The continue route of each held use-case node's type (`usecaseContinuePath`), named as what that run calls. */
  reviewContinuePaths: readonly string[] = [],
): string {
  const quoted = (ids: readonly string[]) => ids.map((id) => `"${id}"`).join(", ")
  const held = [
    ...(renderNodeIds.length > 0 ? [`${renderNodeIds.length === 1 ? "render" : "renders"} ${quoted(renderNodeIds)}`] : []),
    ...(reviewNodeIds.length > 0 ? [`the review of ${quoted(reviewNodeIds)}`] : []),
  ].join("; ")
  const head = `A later continuation of this run (${at}) stopped at its Preview review (${held}): continuing again would stop there too. `
  if (renderNodeIds.length === 1 && reviewNodeIds.length === 0) {
    return (
      head +
      `Render its final first — renderFinal: { renderNodeId: "${renderNodeIds[0]}" } with continueFromExecutionId "${at}"; ` +
      `a continue-from-failed after that builds on the Render final.`
    )
  }
  return (
    head +
    `Finish ${renderNodeIds.length + reviewNodeIds.length > 1 ? "them together" : "it"} first, in one run continuing that execution: ` +
    `send the answer's "next" (continueFromExecutionId "${at}", its nodeIds and inputOverrides — ` +
    `each render at Final, each use-case node continuing the run that made its Preview, and every node after them) to POST /v1/workflows/:id/run. ` +
    (reviewNodeIds.length > 0
      ? `For ${quoted(reviewNodeIds)} that run calls its continue route (${[...new Set(reviewContinuePaths)].map((p) => `POST ${p}`).join(", ") || "its type's continue route"}, ` +
        `"mode": "render-final", no fee) inside the workflow, so the nodes after it run too; calling that route on its own first renders the episode ` +
        `but leaves this chain held, and the same final in "next" is then refused render_final_already_rendered. `
      : "") +
    `A continue-from-failed after that builds on it.`
  )
}
