// backend/src/services/workflow-engine/poll-job-row.ts — the read
// `pollJobToCompletion` makes of its job's row every tick, with the two
// columns it reads TOLERANTLY: `slot_wait_ms` (migration 451) and
// `lane_wait_ms` (migration 568). Staging runs dev code on the shared database
// before a migration reaches it, and a select naming a missing column fails
// whole. Each column is dropped — and remembered as absent for the process,
// through its own module — only when it is the one missing, so a missing lane
// column never stops the slot wait being read, nor the other way round. An
// error that names neither is attributed by elimination: the lane column is
// dropped first and recorded only once the read without it succeeds.
import { supabase } from "../../lib/supabase.js"
import { noteSlotWaitColumnError, slotWaitColumnAbsent } from "../../lib/jobs-slot-wait-column.js"
import { laneColumnsAbsent, noteLaneColumnError } from "../../lib/concurrency-lanes/columns.js"

/** 42703: undefined column (Postgres); PGRST204: unknown column (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])

type PgError = { readonly code?: string | null; readonly message?: string | null }

const isMissingColumn = (error: PgError | null | undefined): error is PgError =>
  !!error?.code && MISSING_COLUMN_CODES.has(error.code)

/**
 * The job's row with `columns`, plus `slot_wait_ms` and `lane_wait_ms` while
 * this database has them. Any other error is returned as it came, like a
 * plain read.
 */
export async function readPollJobRow<Row>(jobId: string, columns: string): Promise<{ data: Row | null; error: PgError | null }> {
  let withSlot = !slotWaitColumnAbsent()
  let withLane = !laneColumnsAbsent("jobs")
  /** The lane column was dropped on an error naming neither: recorded once a read without it succeeds. */
  let laneGuessed = false
  for (let attempt = 0; ; attempt++) {
    const cols = `${columns}${withSlot ? ", slot_wait_ms" : ""}${withLane ? ", lane_wait_ms" : ""}`
    const { data, error } = await supabase.from("jobs").select(cols).eq("id", jobId).single()
    if (!error) {
      if (laneGuessed) noteLaneColumnError("jobs", { code: "42703" })
      return { data: data as unknown as Row, error: null }
    }
    if (!isMissingColumn(error) || (!withSlot && !withLane) || attempt >= 3) return { data: null, error }
    const message = error.message ?? ""
    if (withLane && message.includes("lane_wait_ms")) {
      noteLaneColumnError("jobs", error)
      withLane = false
    } else if (withSlot && message.includes("slot_wait_ms")) {
      noteSlotWaitColumnError(error)
      withSlot = false
    } else if (withLane && !laneGuessed) {
      withLane = false
      laneGuessed = true
    } else {
      // Without the lane column it still failed: the slot column is the missing one.
      noteSlotWaitColumnError(error)
      withSlot = false
      if (laneGuessed) {
        withLane = true
        laneGuessed = false
      }
    }
  }
}
