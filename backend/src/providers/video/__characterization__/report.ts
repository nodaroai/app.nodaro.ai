import { DEFAULT_GOLDEN_FILE, GOLDEN_DIR, loadGolden, type GoldenFile } from "./golden.js"

/* eslint-disable no-console -- CLI reporting tool; stdout IS the deliverable */

/**
 * Per-metric diff between two golden files — the entire deliverable of an
 * ffmpeg upgrade evaluation. Usage (from backend/):
 *
 *   npm run characterize:report -- --against ffmpeg-8.1.json [--base ffmpeg-5.1.9.json]
 *
 * Pure JSON comparison: no ffmpeg needed, runs anywhere. It prints every
 * metric whose delta clears the display floor, so a reviewer can classify
 * each moved metric as improvement / regression / neutral before re-blessing.
 * Always exits 0 — it informs the decision, it does not make it.
 */

const DB_DISPLAY_FLOOR = 0.05
const LUMA_DISPLAY_FLOOR = 0.1

interface DiffRow {
  readonly op: string
  readonly label: string
  readonly metric: string
  readonly base: string
  readonly against: string
  readonly delta: number
}

function parseArgs(): { base: string; against: string } {
  const argv = process.argv.slice(2)
  let base = DEFAULT_GOLDEN_FILE
  let against = ""
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i] ?? base
    else if (argv[i] === "--against") against = argv[++i] ?? ""
  }
  if (!against) {
    console.error(
      "usage: npm run characterize:report -- --against <golden-file> [--base <golden-file>]\n" +
        `golden files live in ${GOLDEN_DIR}`,
    )
    process.exit(1)
  }
  return { base: stripDir(base), against: stripDir(against) }
}

/** Accept "golden/ffmpeg-8.json", a bare name, or an absolute-ish path. */
function stripDir(file: string): string {
  return file.split("/").pop() ?? file
}

function isNumArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number")
}

function displayFloor(metric: string): number {
  return metric.toLowerCase().includes("luma") ? LUMA_DISPLAY_FLOOR : DB_DISPLAY_FLOOR
}

function diffValue(rows: DiffRow[], op: string, label: string, metric: string, a: unknown, b: unknown): void {
  if (typeof a === "number" && typeof b === "number") {
    const delta = b - a
    if (Math.abs(delta) >= displayFloor(metric) || Number.isInteger(a) !== Number.isInteger(b)) {
      rows.push({ op, label, metric, base: String(a), against: String(b), delta })
    }
    return
  }
  if (isNumArray(a) && isNumArray(b)) {
    if (a.length !== b.length) {
      rows.push({ op, label, metric: `${metric}.length`, base: String(a.length), against: String(b.length), delta: b.length - a.length })
    }
    let worst = 0
    let worstIdx = -1
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = b[i] - a[i]
      if (Math.abs(d) > Math.abs(worst)) {
        worst = d
        worstIdx = i
      }
    }
    if (worstIdx >= 0 && Math.abs(worst) >= displayFloor(metric)) {
      rows.push({
        op,
        label,
        metric: `${metric}[${worstIdx}] (worst of ${a.length})`,
        base: String(a[worstIdx]),
        against: String(b[worstIdx]),
        delta: worst,
      })
    }
    return
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      diffValue(rows, op, label, metric ? `${metric}.${key}` : key, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    }
    return
  }
  if (a !== b) {
    rows.push({ op, label, metric, base: String(a), against: String(b), delta: Number.NaN })
  }
}

function diffGoldens(base: GoldenFile, against: GoldenFile): DiffRow[] {
  const rows: DiffRow[] = []
  const ops = new Set([...Object.keys(base.operations), ...Object.keys(against.operations)])
  for (const op of [...ops].sort()) {
    const a = base.operations[op]
    const b = against.operations[op]
    if (!a || !b) {
      rows.push({ op, label: "-", metric: "presence", base: a ? "present" : "MISSING", against: b ? "present" : "MISSING", delta: Number.NaN })
      continue
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const ao = a[i]
      const bo = b[i]
      if (!ao || !bo) {
        rows.push({ op, label: ao?.label ?? bo?.label ?? String(i), metric: "output presence", base: ao ? "present" : "MISSING", against: bo ? "present" : "MISSING", delta: Number.NaN })
        continue
      }
      diffValue(rows, op, ao.label, "", ao.metrics, bo.metrics)
    }
  }
  return rows
}

function fmtDelta(d: number): string {
  if (Number.isNaN(d)) return "≠"
  const sign = d > 0 ? "+" : ""
  return `${sign}${d.toFixed(2)}`
}

async function main(): Promise<void> {
  const { base, against } = parseArgs()
  const [baseGolden, againstGolden] = await Promise.all([loadGolden(base), loadGolden(against)])

  console.log(`characterization report`)
  console.log(`  base:    ${base}  (ffmpeg ${baseGolden.ffmpegVersion})`)
  console.log(`  against: ${against}  (ffmpeg ${againstGolden.ffmpegVersion})`)
  console.log("")

  const rows = diffGoldens(baseGolden, againstGolden)
  if (rows.length === 0) {
    console.log(`no metric moved beyond the display floor (±${DB_DISPLAY_FLOOR} dB / ±${LUMA_DISPLAY_FLOOR} luma) — outputs are equivalent.`)
    return
  }

  const opWidth = Math.max(...rows.map((r) => r.op.length), 9)
  const metricWidth = Math.max(...rows.map((r) => r.metric.length), 6)
  console.log(`${"operation".padEnd(opWidth)}  ${"out".padEnd(6)}  ${"metric".padEnd(metricWidth)}  ${"base".padStart(10)}  ${"against".padStart(10)}  delta`)
  for (const row of rows) {
    console.log(
      `${row.op.padEnd(opWidth)}  ${row.label.padEnd(6)}  ${row.metric.padEnd(metricWidth)}  ${row.base.padStart(10)}  ${row.against.padStart(10)}  ${fmtDelta(row.delta)}`,
    )
  }
  const opCount = new Set(rows.map((r) => r.op)).size
  console.log("")
  console.log(`${rows.length} metric(s) moved across ${opCount} operation(s). Classify each as improvement / regression / neutral before re-blessing.`)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
