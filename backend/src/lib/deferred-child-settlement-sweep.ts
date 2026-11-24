import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import {
  deferRuleOf,
  deferredSettlementOf,
  listOpenDeferredChildren,
  planDeliveredChildren,
  resolveDeferredChild,
  scheduledReleaseOf,
  type DeferredSettleOutcome,
  type OpenDeferredChild,
} from "./deferred-child-settlement.js"

/**
 * CREDITS ARE NEVER LEFT HELD. A deferred child (lib/deferred-child-settlement.ts)
 * is normally settled or released by its plugin. This sweep resolves the ones
 * it did not. It reads only the children whose money is still open (migration
 * 693's partial index), with no look-back window, so an outage of the sweep
 * strands nothing.
 *
 * The person pays for ONE engine run. For a run that COMPLETED (`graceMs` ago):
 *  - a sibling already `settled` → every child still held is RELEASED (they
 *    were the discarded takes);
 *  - none settled, exactly one held → it is SETTLED (the delivered take whose
 *    settle did not land);
 *  - none settled, several held → the most recently completed is SETTLED, the
 *    rest RELEASED.
 * An `[ALERT]` whenever such a run had more than one deferred child and the
 * sweep had to act. For a run that failed or was cancelled (`graceMs` ago), or
 * is gone: every held child is released. For a run still going `longParentMs`
 * after its held child completed: released, with an `[ALERT]` — 12 hours, while
 * the longest Video Remake run's own budget is 7 h 45 min
 * (providers/video/cast-swap-budget.ts: masked "auto", the face check's ladder
 * and the longest upscale wait) and the bound stays under the 24 hours
 * after which the First Remake offer stops waiting for a run's holds
 * (migration 684, `p_ignore_holds`).
 *
 * A `"delivered"` child (deferred-child-request.ts: Video Remake's upscale) is
 * never pooled with the engine takes: its completed run charges it only when
 * its completion lists it among the files it delivered, and releases it
 * otherwise (`planDeliveredChildren`; a completion with no list at all is
 * charged, with an `[ALERT]`); a failed, cancelled, gone or 12-hour run
 * releases it as it does a take — but a run parked for review is waited on
 * however long its review takes (its approve completes it with its list).
 *
 * A child whose release was scheduled while it ran (and that its completion did
 * not release) is released whatever its run's state. It also finishes a
 * decision recorded before a crash (its hold still open) and
 * closes a child whose hold another path settled. Every action goes through
 * `resolveDeferredChild`, so two processes sweeping at once act at most once.
 */
export const DEFERRED_CHILD_SWEEP = {
  everyMinutes: 5,
  graceMs: 10 * 60_000,
  longParentMs: 12 * 3_600_000,
} as const

export interface DeferredChildSweepSummary {
  scanned: number
  settled: number
  released: number
  healed: number
  errors: number
}

interface ParentRow {
  id: string
  status: string
  completed_at: string | null
  /** Read for a `"delivered"` child's decision (`planDeliveredChildren`). */
  output_data?: Record<string, unknown> | null
}

interface SiblingRow {
  id: string
  parent_job_id: string
  completed_at: string | null
  input_data?: Record<string, unknown> | null
  held_completion_fields: Record<string, unknown> | null
}

const IN_BATCH = 100

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += IN_BATCH) out.push(items.slice(i, i + IN_BATCH))
  return out
}

/** Each job's log outcome: "reserved" when any log is still open, else committed / refunded. */
async function logOutcomes(jobIds: readonly string[]): Promise<Map<string, "reserved" | "committed" | "refunded"> | null> {
  const out = new Map<string, "reserved" | "committed" | "refunded">()
  for (const ids of chunks(jobIds)) {
    const { data, error } = await supabase.from("usage_logs").select("job_id, status").in("job_id", ids)
    if (error) {
      console.error(`[deferred-settlement-sweep] reading usage logs failed: ${error.message}`)
      return null
    }
    for (const row of (data ?? []) as Array<{ job_id: string | null; status: string }>) {
      if (!row.job_id) continue
      const seen = out.get(row.job_id)
      if (row.status === "reserved") out.set(row.job_id, "reserved")
      else if (row.status === "committed" && seen !== "reserved") out.set(row.job_id, "committed")
      else if (row.status === "refunded" && seen === undefined) out.set(row.job_id, "refunded")
    }
  }
  return out
}

async function readParents(ids: readonly string[]): Promise<Map<string, ParentRow> | null> {
  const out = new Map<string, ParentRow>()
  for (const batch of chunks([...new Set(ids)])) {
    // trash-read: a run in the Trash still decides what its held steps cost.
    const { data, error } = await supabase.from("jobs").select("id, status, completed_at, output_data").in("id", batch)
    if (error) {
      console.error(`[deferred-settlement-sweep] reading parents failed: ${error.message}`)
      return null
    }
    for (const row of (data ?? []) as ParentRow[]) out.set(row.id, row)
  }
  return out
}

/** Every deferred ENGINE child (any state, open or closed) of the given runs, each run read as its owner's: a `"delivered"` child is never one of a run's takes. */
async function readDeferredSiblings(runs: ReadonlyArray<{ parentId: string; userId: string }>): Promise<Map<string, SiblingRow[]> | null> {
  const out = new Map<string, SiblingRow[]>()
  const byUser = new Map<string, string[]>()
  for (const r of runs) byUser.set(r.userId, [...new Set([...(byUser.get(r.userId) ?? []), r.parentId])])
  for (const [userId, parentIds] of byUser) for (const batch of chunks(parentIds)) {
    // trash-read: the run's other steps, Trash included, decide which take is charged.
    const { data, error } = await supabase
      .from("jobs")
      .select("id, parent_job_id, completed_at, input_data, held_completion_fields")
      .eq("user_id", userId)
      .in("parent_job_id", batch)
      .eq("status", "completed")
    if (error) {
      console.error(`[deferred-settlement-sweep] reading siblings failed: ${error.message}`)
      return null
    }
    for (const row of (data ?? []) as SiblingRow[]) {
      if (!deferredSettlementOf(row.held_completion_fields) || deferRuleOf(row) !== null) continue
      out.set(row.parent_job_id, [...(out.get(row.parent_job_id) ?? []), row])
    }
  }
  return out
}

const ageMs = (iso: string | null | undefined, now: number): number => (iso ? now - Date.parse(iso) : 0)

export interface CompletedRunPlan {
  settle: string[]
  release: string[]
  alert: boolean
}

/**
 * What a COMPLETED run's held children get: release them all when a sibling is
 * already settled; else settle the most recently completed held one and release
 * the rest. `alert` when the run had more than one deferred child.
 */
export function planCompletedRun(siblings: ReadonlyArray<{ id: string; completed_at: string | null; state: string }>, held: readonly string[]): CompletedRunPlan {
  if (held.length === 0) return { settle: [], release: [], alert: false }
  const alert = siblings.length > 1
  if (siblings.some((s) => s.state === "settled")) return { settle: [], release: [...held], alert }
  const heldRows = siblings.filter((s) => held.includes(s.id))
  const keep = [...heldRows].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0]?.id ?? held[held.length - 1]!
  return { settle: [keep], release: held.filter((id) => id !== keep), alert }
}

export async function sweepDeferredChildSettlements(now: Date = new Date()): Promise<DeferredChildSweepSummary> {
  const summary: DeferredChildSweepSummary = { scanned: 0, settled: 0, released: 0, healed: 0, errors: 0 }
  if (!hasCredits()) return summary
  const nowMs = now.getTime()
  const rows = await listOpenDeferredChildren()
  if (!rows) return { ...summary, errors: 1 }
  summary.scanned = rows.length
  if (rows.length === 0) return summary
  const outcomes = await logOutcomes(rows.map((r) => r.id))
  if (!outcomes) return { ...summary, errors: 1 }

  const count = (done: DeferredSettleOutcome) => {
    if (done === "settled") summary.settled++
    if (done === "released") summary.released++
  }
  const act = async (id: string, decision: "settled" | "released", reason?: string) => {
    try {
      count(await resolveDeferredChild(id, decision, { ...(reason ? { reason } : {}), by: "sweep" }))
    } catch (err) {
      summary.errors++
      console.error(`[deferred-settlement-sweep] child ${id}:`, err instanceof Error ? err.message : err)
    }
  }

  // 1. Closed money, open row: brought in line. 2. A decision a crash left unfinished: finished.
  const heldOpen: OpenDeferredChild[] = []
  for (const row of rows) {
    const rec = deferredSettlementOf(row.held_completion_fields)
    if (!rec) continue
    const outcome = outcomes.get(row.id)
    if (outcome !== "reserved") {
      try {
        await resolveDeferredChild(row.id, outcome === "committed" ? "settled" : "released", { by: "sweep" })
        summary.healed++
      } catch (err) {
        summary.errors++
        console.error(`[deferred-settlement-sweep] child ${row.id}:`, err instanceof Error ? err.message : err)
      }
      continue
    }
    const scheduled = scheduledReleaseOf(row.input_data)
    if (rec.state !== "held") await act(row.id, rec.state)
    // A release scheduled while it ran, which its completion did not carry out.
    else if (scheduled) await act(row.id, "released", scheduled.reason)
    else if (row.parent_job_id) heldOpen.push(row)
  }
  if (heldOpen.length === 0) return summary

  // 3. Held children, by their run.
  const parents = await readParents(heldOpen.map((r) => r.parent_job_id!))
  if (!parents) return { ...summary, errors: summary.errors + 1 }
  const byParent = new Map<string, OpenDeferredChild[]>()
  for (const r of heldOpen) byParent.set(r.parent_job_id!, [...(byParent.get(r.parent_job_id!) ?? []), r])

  const completedRuns = [...byParent.keys()].filter((id) => {
    const p = parents.get(id)
    return p?.status === "completed" && ageMs(p.completed_at, nowMs) >= DEFERRED_CHILD_SWEEP.graceMs
  })
  const ownerOf = (parentId: string) => byParent.get(parentId)?.find((c) => c.user_id)?.user_id ?? ""
  const siblings = completedRuns.length > 0
    ? await readDeferredSiblings(completedRuns.map((parentId) => ({ parentId, userId: ownerOf(parentId) })))
    : new Map<string, SiblingRow[]>()
  if (!siblings) return { ...summary, errors: summary.errors + 1 }

  for (const [parentId, all] of byParent) {
    const parent = parents.get(parentId)
    if (!parent) {
      for (const c of all) await act(c.id, "released", "its run no longer exists")
      continue
    }
    // The run's held "delivered" children, decided by what its completion delivered; the rest are its takes.
    const delivered = all.filter((c) => deferRuleOf(c) === "delivered")
    const held = all.filter((c) => deferRuleOf(c) !== "delivered")
    if (completedRuns.includes(parentId) && delivered.length > 0) {
      const plan = planDeliveredChildren(parent.output_data, delivered)
      if (plan.listMissing) {
        console.error(`[ALERT] [deferred-settlement-sweep] run ${parentId} completed without naming the files it delivered — its held step ${plan.settle.join(", ")} is charged${plan.release.length > 0 ? `, ${plan.release.length} other released` : ""}`)
      }
      for (const id of plan.settle) await act(id, "settled")
      for (const id of plan.release) await act(id, "released", "its run did not deliver its file")
    }
    if (completedRuns.includes(parentId) && held.length === 0) continue
    if (parent.status === "completed" && !completedRuns.includes(parentId)) continue // inside the grace period
    if (completedRuns.includes(parentId)) {
      const takes = (siblings.get(parentId) ?? []).map((s) => ({ id: s.id, completed_at: s.completed_at, state: deferredSettlementOf(s.held_completion_fields)?.state ?? "held" }))
      const plan = planCompletedRun(takes.length > 0 ? takes : held.map((c) => ({ id: c.id, completed_at: c.completed_at, state: "held" })), held.map((c) => c.id))
      if (plan.alert) {
        console.error(`[ALERT] [deferred-settlement-sweep] run ${parentId} completed with ${takes.length} deferred children and ${held.length} still held — settling ${plan.settle.length}, releasing ${plan.release.length} (the person pays for one take)`)
      }
      for (const id of plan.settle) await act(id, "settled")
      for (const id of plan.release) await act(id, "released", "a discarded take of a completed run")
      continue
    }
    if (parent.status === "failed" || parent.status === "cancelled") {
      if (parent.completed_at === null || ageMs(parent.completed_at, nowMs) >= DEFERRED_CHILD_SWEEP.graceMs) {
        for (const c of all) await act(c.id, "released", `its run ${parent.status === "failed" ? "failed" : "was cancelled"}`)
      }
      continue
    }
    for (const c of all) {
      if (ageMs(c.completed_at, nowMs) < DEFERRED_CHILD_SWEEP.longParentMs) continue
      // A run parked for review already delivered its "delivered" step's file into the held completion: an approve
      // completes it (and its list charges the step), a refusal fails it (and releases it) — never released for its wait.
      if (parent.status === "pending_review" && deferRuleOf(c) === "delivered") continue
      console.error(`[ALERT] [deferred-settlement-sweep] run ${parentId} is still ${parent.status} 12 hours after its held child ${c.id} completed — the child's credits are released`)
      await act(c.id, "released", "its run did not end in time")
    }
  }
  return summary
}
