import type { AdminJob, AdminJobCredit } from "@/ee/hooks/queries/use-admin-queries"

// What the admin Jobs page shows for a job's credits. `jobs.credits` is the
// HOLD: a run that settled below it (a measured length, a ceiling) was charged
// less, and the rest went back. The settled charge comes from the usage logs
// (`AdminJob.credit`, GET /v1/admin/jobs). Pure, so it is testable without
// rendering. Admin pages are English-only (outside the i18n copy guard).

const n = (v: number): string => v.toLocaleString("en-US")

/**
 * "Charged 854 · held 3,564 (2,710 released)", "Charged 44", or "Held 3,564"
 * while the hold is still open (`open`). A job with no charge recorded and no
 * open hold (a free run, no usage log) shows its hold figure as it is.
 */
export function chargeSentence(
  fig: { charged: number | null; held: number | null; released: number | null },
  open: boolean,
): string | null {
  const { charged, held, released } = fig
  if (charged === null) {
    if (held === null) return null
    return open ? `Held ${n(held)}` : `${n(held)} (no charge recorded)`
  }
  if (held === null || held === charged) return `Charged ${n(charged)}`
  const back = released !== null && released > 0 ? ` (${n(released)} released)` : ""
  return `Charged ${n(charged)} · held ${n(held)}${back}`
}

/** A parent's run, its steps included: "Run with 4 steps: charged 1,063 · held 3,773 (2,710 released)". */
export function runSentence(run: AdminJobCredit["run"]): string | null {
  if (!run) return null
  const steps = run.steps === 1 ? "1 step" : `${run.steps} steps`
  if (run.charged === null) {
    if (run.held === null) return null
    return run.settled ? `Run with ${steps}: ${n(run.held)} (no charge recorded)` : `Run with ${steps}: held ${n(run.held)}`
  }
  if (!run.settled) {
    // A step still holds: the charge so far, with nothing called released yet.
    return `Run with ${steps}: charged ${n(run.charged)} so far · held ${n(run.held ?? 0)}`
  }
  const own = chargeSentence(run, false)
  return own ? `Run with ${steps}: ${own.charAt(0).toLowerCase()}${own.slice(1)}` : null
}

/** The job's own figures, falling back to its hold when the server sent none. */
function ownFigures(job: Pick<AdminJob, "credits" | "credit">) {
  return job.credit ?? { charged: null, held: job.credits ?? null, released: null }
}

/** Whether the job's own hold is still open (only the server's usage-log status says so). */
const holdOpen = (job: Pick<AdminJob, "credit">): boolean => job.credit?.status === "reserved"

/**
 * The compact list cell: the charge as the figure, the hold as secondary text
 * (only while it differs), and a parent's run total. While the job's hold is
 * open the cell reads "held N".
 */
export function creditCell(job: Pick<AdminJob, "credits" | "credit">): { main: string; secondary: string[]; title: string | undefined } {
  const own = ownFigures(job)
  const run = job.credit?.run ?? null
  const secondary: string[] = []
  let main = "-"
  if (own.charged !== null) {
    main = n(own.charged)
    if (own.held !== null && own.held !== own.charged) secondary.push(`held ${n(own.held)}`)
  } else if (own.held !== null) {
    main = holdOpen(job) ? `held ${n(own.held)}` : n(own.held)
  }
  if (run) {
    const steps = run.steps === 1 ? "1 step" : `${run.steps} steps`
    secondary.push(
      run.charged !== null ? `run ${n(run.charged)} · ${steps}` : run.settled ? `run ${n(run.held ?? 0)} · ${steps}` : `run held ${n(run.held ?? 0)} · ${steps}`,
    )
  }
  const title = [chargeSentence(own, holdOpen(job)), runSentence(run)].filter(Boolean).join("\n") || undefined
  return { main, secondary, title }
}

/** The detail dialog's Credits lines: the job's own, then its run's (when it has steps). */
export function creditDetailLines(job: Pick<AdminJob, "credits" | "credit">): string[] {
  return [chargeSentence(ownFigures(job), holdOpen(job)), runSentence(job.credit?.run ?? null)].filter((l): l is string => !!l)
}

/**
 * What one job adds to a total over listed rows: its OWN charge once settled,
 * its hold while open, 0 once refunded. Never a run total — a list shows the
 * steps beside their parent, and each must count once.
 */
export function ownCreditsForTotal(job: Pick<AdminJob, "credits" | "credit">): number {
  const own = ownFigures(job)
  return own.charged ?? own.held ?? 0
}

/** The gallery tile's figure: the charge once settled, "held N" while the hold is open. */
export function creditTileLabel(job: Pick<AdminJob, "credits" | "credit">): string {
  const own = ownFigures(job)
  if (own.charged !== null) return `${n(own.charged)} cr`
  return holdOpen(job) ? `held ${n(own.held ?? 0)} cr` : `${n(own.held ?? 0)} cr`
}

/** A trend test run's charge line: its run figures, "Held N" while it runs. */
export function trendRunCreditLine(run: {
  status: string
  creditsCharged: number | null
  creditsHeld?: number | null
  creditsReleased?: number | null
}): string | null {
  const open = run.creditsCharged === null && ["pending", "queued", "processing", "pending_review"].includes(run.status)
  return chargeSentence({ charged: run.creditsCharged, held: run.creditsHeld ?? null, released: run.creditsReleased ?? null }, open)
}
