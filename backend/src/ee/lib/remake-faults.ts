/**
 * The faults a Video Remake run recorded (pure).
 *
 * The engine records them on the run's own row, also on a run that failed,
 * as the server-only `output_data.__castSwapFaults`: a list of
 * `{ kind, severity, at, detail? }`. `kind` is an open vocabulary
 * (`blur_left`, `unblurred_refused`, `face_check_unsure`, `face_check_error`,
 * `intent_override` today, whose `detail.code` names the intent).
 *
 * The reading here is the one migration 694's `admin_remake_fault_list`
 * applies, so a chip on the job page and a row on the faults list say the
 * same: an element that is not an object, or has no non-blank string `kind`,
 * is skipped; a `severity` outside the three reads as "warning" (shown, never
 * hidden); `at` is kept only as a string and `detail` only as an object. A
 * value that is not a list is no fault. The result is worst first (blocked,
 * recovered, warning), then by `at`, then as recorded.
 */

export const REMAKE_FAULT_SEVERITIES = ["blocked", "recovered", "warning"] as const
export type RemakeFaultSeverity = (typeof REMAKE_FAULT_SEVERITIES)[number]

export interface RemakeFault {
  kind: string
  severity: RemakeFaultSeverity
  /** When it was recorded (ISO), when the record carries one. */
  at?: string
  detail?: Record<string, unknown>
}

/** The server-only key a run records its faults under. */
export const REMAKE_FAULTS_KEY = "__castSwapFaults"

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

const RANK: Readonly<Record<RemakeFaultSeverity, number>> = { blocked: 0, recovered: 1, warning: 2 }

/** A severity as the list reads it: one of the three, anything else "warning". */
export function severityOf(v: unknown): RemakeFaultSeverity {
  return v === "blocked" || v === "recovered" ? v : "warning"
}

/** One recorded fault, or null when it is not one (see the reading above). */
function readFault(v: unknown): RemakeFault | null {
  if (!isRec(v) || typeof v.kind !== "string" || v.kind.trim() === "") return null
  return {
    kind: v.kind,
    severity: severityOf(v.severity),
    ...(typeof v.at === "string" ? { at: v.at } : {}),
    ...(isRec(v.detail) ? { detail: { ...v.detail } } : {}),
  }
}

/** The faults of a recorded list, worst first; [] for anything that is not a list. */
export function readRemakeFaults(v: unknown): RemakeFault[] {
  if (!Array.isArray(v)) return []
  return v
    .map((entry, index) => ({ fault: readFault(entry), index }))
    .filter((x): x is { fault: RemakeFault; index: number } => x.fault !== null)
    .sort((a, b) => {
      const bySeverity = RANK[a.fault.severity] - RANK[b.fault.severity]
      if (bySeverity !== 0) return bySeverity
      // `at` ascending, a fault with none after those with one (the SQL's NULLS LAST).
      const [x, y] = [a.fault.at, b.fault.at]
      if (x !== y) {
        if (x === undefined) return 1
        if (y === undefined) return -1
        return x < y ? -1 : 1
      }
      return a.index - b.index
    })
    .map((x) => x.fault)
}
