// backend/src/lib/concurrency-lanes/worker-admit.ts — the pickup gate of the
// BullMQ workers: before a worker claims a job's row it asks for the job's
// slot, and the job's handler then runs under the hold it got.
//
// In order:
//   1. the server share (server-share.ts): a job over its user's share of
//      this process's pool (or, on the video pool, over the coordinator
//      share) is refused while lanes are enforced — it takes no slot and is
//      parked with reason `server_busy`, woken when a job of its user leaves
//      the pool here, else by its backstop. A re-admitted job and a child of
//      a running parent are counted but never refused;
//   2. a LEAF child of a parent that holds a leaf lease runs under that lease
//      (borrow): no acquire, and its release never touches the parent's lease.
//      A coordinator child never borrows: it keeps its coordinator hold, so
//      each of its calls takes its own slot;
//   3. classify (registry.ts): a nested coordinator — its row names a parent
//      job, a workflow execution or a pipeline, or its payload the lane-only
//      `laneParent` marker or (a nested workflow execution) the
//      `parentExecutionId` of the run that started it — takes no slot, is
//      never refused by the server share, and runs under a coordinator hold.
//      The payload's markers are not taken on its word (a route may pass a
//      client's body into it): `parentExecutionId` counts only on the
//      orchestration queue, whose payloads the server builds field by field,
//      and `laneParent` only once the director it names is seen running for
//      the same user (lane-parent.ts — one read, only when a marker is there);
//      a top-level coordinator takes a slot of the `run` lane; a leaf, one of
//      its own lane;
//   4. acquire, in mode
//        readmit — the row is `processing`: the job already started (a drain
//                  hand-back, a stall re-pick, a BullMQ retry, the captions
//                  `render` hand-off). Always granted, never parked; its old
//                  lease is reclaimed. Status only: sync rows are inserted
//                  with `started_at` set, and BullMQ's attempt counters say
//                  nothing about whether the row ran;
//        front   — a child of a running coordinator (a parent job holding no
//                  leaf lease, a pipeline stage, a director's child): it goes
//                  ahead of jobs that have not started;
//        fresh   — everything else.
//
// The line (user × payer) comes from the payload's billing context when the
// payload names the row's user and the row bears the context out (same
// workspace, a deployment payer only where this instance bills one), else
// from the row (payer.ts). Sizes come from sizes.ts; the provider's platform
// ceiling is the gate's own.
//
// With enforcement off every acquire is granted (one that would have waited is
// an over-limit lease), so nothing here changes what a worker does. With it on,
// a refused job is handed to the not-admitted handler (registerNotAdmittedHandler),
// which parks it (park.ts; the workers register it); until a park is registered
// the job runs ungated and counted.
//
// The server share counts what runs: a refused job leaves it, and a job that
// runs anyway (ungated, after a gate failure or a park that could not happen)
// counts in it until released.
//
// A re-picked job may find its lease held by ANOTHER BullMQ entry of the same
// job (the captions `render` it handed its slot to, before it died and was
// picked up again): it runs under that lease and never renews, hands off or
// releases it — the render does.
//
// While limits cannot be turned on in this release (lanesMeasureOnly), a
// pickup never waits for any of this: the job runs at once under the hold its
// row and payload decide, and its admission is fired and only counted
// (admitWithoutWaiting); its release and hand-over chain on that admission.
//
// Fails open: any failure of the gate (no answer within its call timeout, a
// Redis error, the module not loading) or of the lane config admits the job
// ungated, counted, with a best-effort withdraw of its entry. A lane problem
// never fails or holds back a job beyond one bounded gate call.
//
// Provider attribution (provider-of.ts) reads the LIVE provider registry, so it
// is right only in a process that ran initProviders() — the video worker does.
// The render worker does not, and needs not: every render-queue job is a
// `local` leaf, attributed to "local" before any registry lookup.
import { randomUUID } from "node:crypto"
import { payloadBillingContext, type BillingContext } from "../billing-context.js"
import { deploymentPayerId } from "../deployment-payer.js"
import { runtimeSurfaceProfile } from "../surface-profile.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus, type JobStatus } from "../job-status.js"
import { LANE_LEASE_TTL_MS, LaneGateTimeoutError, type ConcurrencyGate, type ReleaseOutcome, type WakeTarget } from "./gate.js"
import { registerSlotHandOff } from "./handoff.js"
import {
  countFailOpen, countUngated, keepLeaseAlive, loadConcurrencyGate, logLaneRateLimited, warnLaneRateLimited, type ConcurrencyHold,
} from "./hold.js"
import { payerKeyOf, payerOfRow } from "./payer.js"
import { laneParentInPayload, laneParentIsLive } from "./lane-parent.js"
import { laneClassOf } from "./registry.js"
import { noteServerWaiter, SERVER_POOL_OF as POOL, serverShareOf, type ServerPool, type ServerShareKey } from "./server-share.js"
import { laneSizesFor } from "./sizes.js"
import { fireWithoutWaiting, lanesMeasureOnly } from "./slot.js"
import type { ConcurrencyLane, LaneClass, LaneEntryMeta, LaneQueueName, PayerKey, WaitInfo } from "./types.js"

/** The jobs-row columns admission reads (each selected by the workers' pickup read). */
export interface WorkerRow {
  id: string
  user_id: string
  status: string
  started_at: string | null
  parent_job_id: string | null
  workflow_execution_id: string | null
  pipeline_id: string | null
  workspace_id: string | null
  org_id: string | null
  source: string | null
  source_detail: string | null
  mcp_client: string | null
}

/** The columns of WorkerRow, for a worker's select list. */
export const WORKER_ROW_COLUMNS =
  "id, user_id, status, started_at, parent_job_id, workflow_execution_id, pipeline_id, workspace_id, org_id, source, source_detail, mcp_client"

/** The BullMQ options a parked job is added again with, if Redis loses it. */
export interface BullJobOpts {
  priority?: number
  attempts?: number
  backoff?: unknown
  removeOnComplete?: unknown
  removeOnFail?: unknown
}

/** The BullMQ job, as admission reads it. A real BullMQ job also carries what parking needs. */
export interface AdmittedBullJob {
  id?: string | null
  name: string
  data: unknown
  opts?: BullJobOpts
  moveToDelayed?(timestamp: number, token?: string): Promise<void>
  promote?(): Promise<void>
}

export interface AdmittedJob {
  admitted: true
  /** The lease the job holds (its own, or its parent's when borrowed); null when it holds none. */
  leaseId: string | null
  /** The hold the job's handler runs under (runHolding). */
  hold: ConcurrencyHold
  /** Free what the admission took, exactly once: later calls (and a borrowed or leaseless admission's) do nothing. Never throws. */
  release(outcome: ReleaseOutcome): Promise<void>
}

export type Admission =
  | AdmittedJob
  | {
    admitted: false
    wait: WaitInfo
    /** The hold the job would have run under, with no lease. */
    hold: ConcurrencyHold
  }

/** The prefix of the BullMQ id under which a job Redis lost is added again; its claim accepts only a `queued` row. */
export const LANE_READD_PREFIX = "lane-readd-"

/**
 * The statuses a worker's pickup claim accepts: every in-flight status but a
 * row held for review — `pending`, a waiting job's `queued`, a re-picked
 * job's `processing`. A job added again after Redis lost it
 * (`lane-readd-<jobId>`) runs only from `queued`, so it can never run a job a
 * live entry already started.
 */
const PICKUP_STATUSES: readonly JobStatus[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

export function pickupStatusesFor(bullJobId: string | null | undefined): JobStatus[] {
  return typeof bullJobId === "string" && bullJobId.startsWith(LANE_READD_PREFIX)
    ? ["queued"]
    : [...PICKUP_STATUSES]
}

// ------------------------------------------------------------------ hooks

let onWakeTargets: (targets: WakeTarget[]) => Promise<void> = async () => {}

/** Who promotes the waiters a release reserved a slot for (the park module). */
export function registerWakeTargetsHandler(fn: (targets: WakeTarget[]) => Promise<void>): void {
  onWakeTargets = fn
}

export interface NotAdmittedArgs {
  job: AdmittedBullJob
  token: string | undefined
  queue: LaneQueueName
  row: WorkerRow
  wait: WaitInfo
  /** The hold the job would run under, with no lease (for running it ungated). */
  hold: ConcurrencyHold
}

/** "parked": the job was put back to wait (the worker ends its attempt); else run it under this admission. */
export type NotAdmittedHandler = (args: NotAdmittedArgs) => Promise<"parked" | AdmittedJob>

/**
 * Run a job its lane refused anyway, holding no slot: its entry is withdrawn so
 * it does not stand at the head of its line, and it counts in the server share
 * again (refusal left it) — never refused there. `countAsUngated`: it really
 * runs (false for a row the claim will discard). Never throws.
 */
export async function runRefusedJobUngated(args: Pick<NotAdmittedArgs, "job" | "queue" | "row" | "hold">, countAsUngated = true): Promise<AdmittedJob> {
  const { job, queue, row, hold } = args
  if (countAsUngated) countUngated(job.name)
  await withdrawQuietly(row.id)
  let leave: (() => void) | null = null
  const pool = POOL[queue]
  if (pool && row.user_id) {
    const share = serverShareOf(pool).tryEnter({ userId: row.user_id, jobId: row.id, coordinator: hold.role !== "leaf", exempt: true })
    if (share.entered) leave = share.leave
  }
  return leaselessAdmission(hold, leave)
}

/** Until jobs can park, a refused job runs anyway, ungated and counted. */
const runRefusedUngated: NotAdmittedHandler = async (args) => {
  warnLaneRateLimited("a job its lane refused ran ungated (waiting is not available yet)", new Error(args.job.name))
  return runRefusedJobUngated(args)
}

let onNotAdmitted: NotAdmittedHandler = runRefusedUngated

/** Who handles a job its lane refused (the park module); the default runs it ungated. */
export function registerNotAdmittedHandler(fn: NotAdmittedHandler): void {
  onNotAdmitted = fn
}

/** For tests: the default hooks again. */
export function resetWorkerAdmitHooksForTests(): void {
  onWakeTargets = async () => {}
  onNotAdmitted = runRefusedUngated
}

// ---------------------------------------------------------------- helpers

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a payload's deployment payer is this instance's. Only an instance
 * whose surface profile names a payer account bills a deployment payer, and
 * there every run is billed to it; the id is compared wherever this process
 * knows it (the API server resolved it at boot; a profile may name it by
 * uuid). Never throws.
 */
function isThisDeploymentPayer(payerId: string): boolean {
  try {
    const account = runtimeSurfaceProfile().billing.payerAccount
    if (!account) return false
    if (UUID_RE.test(account) && account.toLowerCase() !== payerId.toLowerCase()) return false
    const resolved = deploymentPayerId()
    return resolved === null || resolved === payerId
  } catch {
    return false
  }
}

/**
 * Whether a payload's billing context agrees with the job's row — the row was
 * written by the server from the context it resolved (the payer pair
 * `workspace_id`/`org_id`, insert-job.ts), while a payload can carry fields a
 * route copied from a client's body. The same requester; a personal context
 * on a row with no workspace; a workspace context naming the row's workspace
 * (and org); a deployment context only where this instance bills one.
 */
function payloadAgreesWithRow(ctx: BillingContext, row: WorkerRow): boolean {
  if (ctx.userId !== row.user_id) return false
  switch (ctx.payer) {
    case "user":
      return row.workspace_id === null
    case "workspace":
      return ctx.workspaceId === row.workspace_id && (row.org_id === null || ctx.orgId === row.org_id)
    case "deployment":
      return row.workspace_id === null && typeof ctx.payerId === "string" && isThisDeploymentPayer(ctx.payerId)
    default:
      return false
  }
}

/**
 * The line of a job. Its payload's billing context when the payload names the
 * row's own user and the context agrees with the row (payloadAgreesWithRow);
 * otherwise — no user in the payload, another user, a context the row does
 * not bear out, a malformed one — the row's own line (payerOfRow). A body a
 * route spread into the payload therefore cannot move a job onto another
 * payer's line.
 */
function lineOf(data: Record<string, unknown>, row: WorkerRow): { payer: PayerKey; tier: string | null } {
  const userId = str(data.userId)
  if (userId && userId === row.user_id) {
    try {
      const ctx: BillingContext = payloadBillingContext({ userId, billingContext: data.billingContext as BillingContext | undefined })
      if (payloadAgreesWithRow(ctx, row)) {
        return { payer: payerKeyOf(ctx), tier: ctx.payer === "user" ? null : (str(ctx.entitlements?.tierForGates) ?? null) }
      }
    } catch {
      // A malformed billing context: the row's line.
    }
  }
  return payerOfRow(row)
}

/**
 * A child of a running coordinator, by its row, the lane-only marker of its
 * payload, or — a workflow execution started by a node of a running run (a
 * component or a use-case node) — the parent run its payload names.
 *
 * The payload's fields are checked, never trusted: `parentExecutionId` counts
 * only on the orchestration queue (its starters set it from the internal
 * header alone — orchestration-add-census.test.ts), and `laneParent` only when
 * the director it names runs, for this user, now. A marker that cannot be
 * verified is no marker: the job is admitted as any other. Never throws.
 */
async function isCoordinatorChild(data: Record<string, unknown>, row: WorkerRow, queue: LaneQueueName): Promise<boolean> {
  if (isCoordinatorChildByRow(data, row, queue)) return true
  const parent = laneParentInPayload(data)
  return parent ? laneParentIsLive(parent, row.user_id) : false
}

/** The part of isCoordinatorChild that needs no read: the row's parent, and a nested run's `parentExecutionId`. */
function isCoordinatorChildByRow(data: Record<string, unknown>, row: WorkerRow, queue: LaneQueueName): boolean {
  if (row.parent_job_id || row.pipeline_id) return true
  return queue === "workflow-orchestration" && str(data.parentExecutionId) !== null
}

type ProviderOf = typeof import("./provider-of.js")
let providerOfModule: Promise<ProviderOf> | null = null

/** provider-of, loaded once (it reaches the provider registry and the LLM router). */
function loadProviderOf(): Promise<ProviderOf> {
  if (!providerOfModule) {
    const p = import("./provider-of.js")
    providerOfModule = p
    p.catch(() => {
      if (providerOfModule === p) providerOfModule = null
    })
  }
  return providerOfModule
}

/** The provider a job counts against: "local" for a local leaf, its attribution for another leaf, none for a coordinator. */
async function providerOf(cls: LaneClass, job: AdmittedBullJob): Promise<string | null> {
  if (cls.kind !== "leaf") return null
  if (cls.lane === "local") return "local"
  return (await loadProviderOf()).primaryProviderOfJob(job.name, job.data)
}

async function withdrawQuietly(jobId: string, gate?: ConcurrencyGate | null): Promise<void> {
  try {
    await (gate ?? (await loadConcurrencyGate())).withdraw(jobId)
  } catch (err) {
    warnLaneRateLimited("could not withdraw a job's lane entry", err)
  }
}

type ShareEntry = { entered: true; leave(): void } | { entered: false; wait: WaitInfo }

/**
 * Enter the job's server share (server-share.ts). Over the share it is refused
 * only while lanes are enforced: its wait is recorded in the gate (reason
 * `server_busy`) and it holds nothing. A job that also waits in its lane line
 * keeps its place there, held (the gate's SERVER_WAIT): a slot reserved for it
 * is given up, and its line reserves nothing at or behind it until its next
 * acquire — so it never sits parked on a slot nor wakes itself on one. With
 * enforcement off — or when the flag cannot be read or the wait cannot be
 * recorded — it enters, counted over the cap. The over-share path alone makes
 * Redis calls. Never throws.
 */
async function enterServerShare(pool: ServerPool, key: ServerShareKey, waitMeta: LaneEntryMeta): Promise<ShareEntry> {
  const share = serverShareOf(pool)
  const first = share.tryEnter(key)
  if (first.entered) return first
  try {
    const gate = await loadConcurrencyGate()
    if (await gate.isEnforced()) {
      // Checked again: a job of the user may have left while the flag was read.
      const again = share.tryEnter(key)
      if (again.entered) return again
      return { entered: false, wait: await gate.markServerWait({ ...waitMeta, pool }) }
    }
  } catch (err) {
    warnLaneRateLimited("could not hold back a job over its server share, letting it in", err)
  }
  const counted = share.tryEnter({ ...key, exempt: true })
  return counted.entered ? counted : { entered: true, leave: () => {} }
}

/** An admission that holds no lease of its own: release only leaves the share. */
function leaselessAdmission(hold: ConcurrencyHold, leave: (() => void) | null): AdmittedJob {
  let released = false
  return {
    admitted: true,
    leaseId: hold.leaseId,
    hold,
    async release() {
      if (released) return
      released = true
      leave?.()
    },
  }
}

/** An admission as admitWorkerJob grants it: a leased one can also be handed over (release as `handoff`). */
type GrantedAdmission = AdmittedJob & { handOff?(): Promise<void> }

/** What a measured admission (admitWithoutWaiting) hands admitWorkerJob. */
interface MeasuredGrant {
  /** The id its lease is asked under. */
  leaseId: string
  /** True once the job's release was asked: a lease landing after it is not kept alive (it is freed at once). */
  releasing(): boolean
}

/**
 * An admission holding its own lease: kept alive until released, released
 * once, its wakes handed on. Under a measured admission (`measured`) its
 * hand-off is not registered here — the measured admission registered its
 * own, at once, and calls `handOff` once this one lands — and it is not kept
 * alive when the job's release came first.
 */
function leasedAdmission(hold: ConcurrencyHold & { leaseId: string }, meta: LaneEntryMeta, leave: () => void, measured?: MeasuredGrant): GrantedAdmission {
  const keep = measured?.releasing() ? null : keepLeaseAlive(hold.leaseId, meta)
  let released = false
  let unregister = () => {}
  const release = async (outcome: ReleaseOutcome): Promise<void> => {
    if (released) return
    released = true
    keep?.stop()
    unregister()
    leave()
    try {
      const targets = await (await loadConcurrencyGate()).release(hold.leaseId, outcome)
      if (targets.length > 0) await onWakeTargets(targets)
    } catch (err) {
      // A lease nobody releases expires after its TTL.
      warnLaneRateLimited("could not release a job's lease", err)
    }
  }
  const handOff = () => release("handoff")
  if (!measured) unregister = registerSlotHandOff(meta.jobId, handOff)
  return { admitted: true, leaseId: hold.leaseId, hold, release, handOff }
}

// ------------------------------------------------------------------ admit

/**
 * The table whose row a queue's job id names, for keeping the job's in-handler
 * wait on it (coordinator-wait.ts). A workflow execution keeps its own
 * (execution-wait.ts), so its queue has none.
 */
const WAIT_TABLE: Partial<Record<LaneQueueName, "jobs" | "pipelines">> = {
  "video-generation": "jobs",
  "video-render": "jobs",
  "video-director": "jobs",
  "pipeline-orchestration": "pipelines",
}

/** What an admission decides before any gate call or read: the job's class, its line and the hold it runs under. */
interface AdmissionPlan {
  data: Record<string, unknown>
  cls: LaneClass
  line: { payer: PayerKey; tier: string | null }
  /** A coordinator that takes no slot (a child of a running coordinator, or a run's own job). */
  nested: boolean
  lane: ConcurrencyLane | null
  /** The hold, with no lease yet. */
  base: ConcurrencyHold
}

function planAdmission(job: AdmittedBullJob, queue: LaneQueueName, row: WorkerRow, coordinatorChild: boolean): AdmissionPlan {
  const data = record(job.data)
  let cls: LaneClass = { kind: "coordinator" }
  let line: { payer: PayerKey; tier: string | null } = { payer: `user:${row.user_id}`, tier: null }
  try {
    cls = laneClassOf(queue, job.name, job.data)
    line = lineOf(data, row)
  } catch (err) {
    logLaneRateLimited("error", "could not classify a job for its lane, running it ungated", err)
  }
  const nested = cls.kind === "coordinator" && (coordinatorChild || row.workflow_execution_id !== null)
  const lane: ConcurrencyLane | null = cls.kind === "leaf" ? cls.lane : nested ? null : "run"
  const role: ConcurrencyHold["role"] = cls.kind === "leaf" ? "leaf" : nested ? "coordinator" : "run"
  const waitTable = WAIT_TABLE[queue]
  const base: ConcurrencyHold = {
    role, lane, userId: row.user_id, payer: line.payer, tier: line.tier, jobId: row.id, leaseId: null, ...(waitTable ? { waitTable } : {}),
  }
  return { data, cls, line, nested, lane, base }
}

/**
 * Admit a job a worker picked up, before it claims the row (see the module
 * comment). Never throws: a gate or config failure admits the job ungated.
 * `measured` (admitWithoutWaiting): its lease is created under that id (a
 * re-admitted job may get its old one back), and leasedAdmission's hand-off
 * and renewals follow the measured admission.
 */
export async function admitWorkerJob(
  args: { job: AdmittedBullJob; queue: LaneQueueName; row: WorkerRow },
  measured?: MeasuredGrant,
): Promise<Admission> {
  const { job, queue, row } = args
  const coordinatorChild = await isCoordinatorChild(record(job.data), row, queue)
  const { data, cls, line, nested, lane, base } = planAdmission(job, queue, row, coordinatorChild)
  const readmit = row.status === "processing"

  // No row (its read failed) and no user in the payload: nothing to count it
  // against. The worker goes on as it always has.
  if (!row.user_id) {
    countUngated(job.name)
    return leaselessAdmission(base, null)
  }

  const metaOf = (entryLane: ConcurrencyLane, provider: string | null): LaneEntryMeta => ({
    jobId: row.id,
    userId: row.user_id,
    payer: line.payer,
    lane: entryLane,
    provider,
    source: row.source,
    sourceDetail: row.source_detail,
    jobType: job.name,
    model: str(data.model) ?? str(data.provider),
    queue,
    bullJobId: job.id ?? null,
  })

  let gate: ConcurrencyGate | null = null
  let leave: (() => void) | null = null
  try {
    // The share first: a job it refuses takes no lane slot while it waits.
    const pool = POOL[queue]
    if (pool) {
      const share = await enterServerShare(
        pool,
        { userId: row.user_id, jobId: row.id, coordinator: cls.kind === "coordinator", exempt: readmit || coordinatorChild },
        metaOf(lane ?? "run", null),
      )
      if (!share.entered) return { admitted: false, wait: share.wait, hold: base }
      leave = share.leave
    }
    gate = await loadConcurrencyGate()

    // Only a LEAF child runs under its parent's lease. A coordinator child
    // keeps its coordinator hold (below): under a leaf hold its whole fan-out
    // would run on the one borrowed slot.
    if (row.parent_job_id && cls.kind === "leaf") {
      const parentLease = await gate.borrow(row.parent_job_id)
      if (parentLease) {
        if (row.status === "queued") void withdrawQuietly(row.id, gate)
        return leaselessAdmission({ ...base, leaseId: parentLease }, leave)
      }
    }
    // A job that waited (`queued`) and now takes no slot clears the wait it left in the gate.
    if (nested) {
      if (row.status === "queued") void withdrawQuietly(row.id, gate)
      return leaselessAdmission(base, leave)
    }

    const slotLane = lane as ConcurrencyLane
    const [sizes, provider] = await Promise.all([laneSizesFor({ userId: row.user_id, payer: line.payer, tier: line.tier }), providerOf(cls, job)])
    const meta = metaOf(slotLane, provider)
    const mode = readmit ? "readmit" : coordinatorChild ? "front" : "fresh"
    const r = await gate.acquire({ meta, size: sizes[slotLane], mode, leaseTtlMs: LANE_LEASE_TTL_MS, ...(measured ? { leaseId: measured.leaseId } : {}) })
    if (!r.granted) {
      leave?.()
      return { admitted: false, wait: r.wait, hold: base }
    }
    // Another BullMQ entry of this job holds the lease (see the module comment): run under it, never release it.
    if (r.foreign) return leaselessAdmission({ ...base, leaseId: r.leaseId }, leave)
    return leasedAdmission({ ...base, leaseId: r.leaseId }, meta, leave ?? (() => {}), measured)
  } catch (err) {
    // The gate did not answer, failed, or the line could not be sized: run ungated.
    if (err instanceof LaneGateTimeoutError) {
      countFailOpen("gate-timeout")
      warnLaneRateLimited("the concurrency gate did not answer in time at pickup, running the job ungated", err)
    } else {
      countFailOpen("gate-error")
      logLaneRateLimited("error", "the concurrency gate failed at pickup, running the job ungated", err)
    }
    countUngated(job.name)
    void withdrawQuietly(row.id, gate)
    return leaselessAdmission(base, leave)
  }
}

/**
 * Admit the job, or hand it to the not-admitted handler when its lane refuses
 * it. Null: the job was parked — the worker ends this attempt (DelayedError)
 * without claiming the row.
 */
export async function admitOrPark(args: {
  job: AdmittedBullJob
  token: string | undefined
  queue: LaneQueueName
  row: WorkerRow
}): Promise<AdmittedJob | null> {
  if (lanesMeasureOnly()) return admitWithoutWaiting(args)
  const admission = await admitWorkerJob(args)
  if (admission.admitted) return admission
  try {
    const verdict = await onNotAdmitted({ ...args, wait: admission.wait, hold: admission.hold })
    if (verdict !== "parked") return verdict
    // Parked for its user's server share: a job of that user leaving this pool wakes it.
    const pool = POOL[args.queue]
    if (pool && admission.wait.reason === "server_busy") {
      noteServerWaiter(pool, args.row.user_id, { jobId: args.row.id, queue: args.queue, bullJobId: args.job.id ?? null }, admission.hold.role !== "leaf")
    }
    return null
  } catch (err) {
    // A park that failed must not lose the job: run it ungated.
    logLaneRateLimited("error", "could not park a job its lane refused, running it ungated", err)
    return runRefusedJobUngated({ ...args, hold: admission.hold })
  }
}

/**
 * Limits locked (lanesMeasureOnly): admit the job at once and measure it
 * without waiting, as a call's take is (slot.ts takeWithoutWaiting). The job
 * runs under the hold its row and payload decide with no read, holding the
 * lease id its admission asks for; the admission itself — the server share,
 * the borrow, the check of a `laneParent` marker, the sizes and the acquire —
 * is fired and never awaited. One the gate would not grant at once is never
 * parked (the job already runs): its entry is withdrawn and it counts as
 * ungated. The release chains on the fired admission and never waits for the
 * gate: it frees exactly what that admission took — the lease it landed, a
 * re-admitted job's own, never another entry's — once, whenever it lands; a
 * lease that lands after the release is never kept alive. This is the shape
 * a call's take has too (slot.ts fireWithoutWaiting). A hand-over
 * (handoff.ts) is registered at once and chains on the admission the same
 * way, so it no longer reaches the gate before the job enqueues its successor
 * (see handoff.ts).
 *
 * The hold is decided from what needs no read: a coordinator whose only parent
 * is an unverified `laneParent` marker runs under a run hold, where the fired
 * admission may find it nested and take no run slot. A run and a coordinator
 * hold treat their calls alike (each takes its own slot), so only the count
 * of the run lane can differ, never what the job does.
 */
function admitWithoutWaiting(args: { job: AdmittedBullJob; token: string | undefined; queue: LaneQueueName; row: WorkerRow }): AdmittedJob {
  const { job, queue, row } = args
  const leaseId = randomUUID()
  const { base } = planAdmission(job, queue, row, isCoordinatorChildByRow(record(job.data), row, queue))
  const hold: ConcurrencyHold = base.role === "coordinator" || !row.user_id ? base : { ...base, leaseId }
  let unregister = () => {}
  const fired = fireWithoutWaiting<GrantedAdmission>(
    (releasing) => admitWorkerJob(args, { leaseId, releasing })
      .then((a) => (a.admitted ? a : runRefusedJobUngated({ ...args, hold: a.hold }))),
    (err) => {
      // admitWorkerJob never throws; should it, the job ran anyway, ungated.
      warnLaneRateLimited("a measured admission failed", err)
      countUngated(job.name)
      return leaselessAdmission(base, null)
    },
    (a, outcome) => a.release(outcome),
  )
  const release = (outcome: ReleaseOutcome): Promise<void> => {
    unregister()
    return fired.release(outcome)
  }
  // Only a leased admission hands its slot over; the job's own release after it changes nothing.
  unregister = registerSlotHandOff(row.id, () => {
    void fired.landed.then((a) => a.handOff?.())
    return Promise.resolve()
  })
  return { admitted: true, leaseId: hold.leaseId, hold, release }
}

/** A row read that failed: admission still runs, on the payload's line, as a fresh job. */
export function workerRowOf(jobId: string, row: Partial<Record<keyof WorkerRow, unknown>> | null | undefined, fallbackUserId: unknown): WorkerRow {
  const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
  return {
    id: jobId,
    user_id: s(row?.user_id) ?? s(fallbackUserId) ?? "",
    status: s(row?.status) ?? "pending",
    started_at: s(row?.started_at),
    parent_job_id: s(row?.parent_job_id),
    workflow_execution_id: s(row?.workflow_execution_id),
    pipeline_id: s(row?.pipeline_id),
    workspace_id: s(row?.workspace_id),
    org_id: s(row?.org_id),
    source: s(row?.source),
    source_detail: s(row?.source_detail),
    mcp_client: s(row?.mcp_client),
  }
}
