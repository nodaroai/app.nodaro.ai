/**
 * How many processes and threads this container may have, how many it has, and
 * how often the kernel has refused one more.
 *
 * WHY. A container's process limit (cgroup `pids.max`) counts every thread of
 * every program in it together — 1,000 on the platform's containers when it
 * was last read. On 2026-11-25 two renders at once used all of them: an
 * encoder could not open ("Error while opening encoder"), a frame server could
 * not start a thread, other jobs could not start ffmpeg at all (`spawn …
 * EAGAIN`), and the proxy died asking for one more thread — every page
 * answered 502 for 27 minutes. Nothing in the logs said how close the
 * container was or which program held the threads: the cause was inferred from
 * what failed.
 *
 * The kernel counts each refusal (`pids.events`, the `max` line), so a
 * shortage is a number that can be read, not a guess from the text of whatever
 * failed. This file reads it, together with the limit, the count in use and
 * the per-user limit (`ulimit -u`), and counts the threads of each program —
 * so a boot line states the limits a deployment really has, and every refusal
 * is logged with who held the threads (`process-shortage.ts`).
 *
 * A dependency-free leaf (node:fs + the CPU readers): pure parsers plus
 * readers with injectable file sources, so every branch is tested without a
 * cgroup.
 */
// @reads-none reads /proc and /sys/fs/cgroup for the container's process limit
import { readFileSync, readdirSync } from "node:fs"
import { cpus } from "node:os"
import { affinityCpuCount, cgroupCpuQuota, type ReadText } from "../providers/video/ffmpeg-threads.js"

/** The names in a directory, or an empty list when it cannot be read. */
export type ListDir = (path: string) => readonly string[]

const readText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

const listDir: ListDir = (path) => {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

export interface ProcessLimits {
  /** The most processes and threads the container may have (`pids.max`); undefined when unlimited or unreadable. */
  readonly pidsMax: number | undefined
  /** How many it has now (`pids.current`). */
  readonly pidsCurrent: number | undefined
  /** The most it has had (`pids.peak`, newer kernels). */
  readonly pidsPeak: number | undefined
  /** How many times the kernel refused a new process or thread at the limit (`pids.events`, `max`). */
  readonly refusals: number | undefined
  /** This user's own limit on processes and threads (`ulimit -u`); undefined when unlimited or unreadable. */
  readonly userProcessLimit: number | undefined
}

/** A kernel counter file: a whole number, or undefined for `max` and anything else. */
export function parseCount(text: string | undefined): number | undefined {
  const value = text?.trim()
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

/** The `max` line of `pids.events`: the refusals so far. */
export function parsePidsEvents(text: string | undefined): number | undefined {
  const line = text?.split("\n").find((l) => l.startsWith("max "))
  return line === undefined ? undefined : parseCount(line.slice("max ".length))
}

/** The soft "Max processes" limit of `/proc/self/limits`; undefined when unlimited. */
export function parseUserProcessLimit(limitsText: string | undefined): number | undefined {
  const line = limitsText?.split("\n").find((l) => l.startsWith("Max processes"))
  return line === undefined ? undefined : parseCount(line.slice("Max processes".length).trim().split(/\s+/)[0])
}

/**
 * The cgroup directories that can hold this process's limit, nearest first:
 * its own cgroup up to the mount root (cgroup v2, `0::<path>` — a parent's
 * limit binds as much as its own), then cgroup v1's pids controller.
 */
export function pidsCgroupDirs(read: ReadText = readText): string[] {
  const lines = (read("/proc/self/cgroup") ?? "").split("\n")
  const dirs: string[] = []
  const v2 = lines.find((line) => line.startsWith("0::"))
  if (v2 !== undefined) {
    let rel = v2.slice(3).trim() || "/"
    for (;;) {
      dirs.push(`/sys/fs/cgroup${rel === "/" ? "" : rel}`)
      if (rel === "/") break
      rel = rel.slice(0, rel.lastIndexOf("/")) || "/"
    }
  }
  const v1 = lines.find((line) => /^\d+:([^:]*,)?pids(,[^:]*)?:/.test(line))
  if (v1 !== undefined) {
    const rel = v1.slice(v1.indexOf(":", v1.indexOf(":") + 1) + 1).trim()
    dirs.push(`/sys/fs/cgroup/pids${rel === "/" ? "" : rel}`)
  }
  dirs.push("/sys/fs/cgroup/pids")
  return [...new Set(dirs)]
}

/**
 * The container's process limit as the kernel states it now. The limit is the
 * tightest one on the way up from this process's cgroup, and the counts are
 * read where that limit is; with no limit anywhere, where a count can be read.
 */
export function readProcessLimits(read: ReadText = readText): ProcessLimits {
  const dirs = pidsCgroupDirs(read)
  let limited: { dir: string; max: number } | undefined
  for (const dir of dirs) {
    const max = parseCount(read(`${dir}/pids.max`))
    if (max !== undefined && (limited === undefined || max < limited.max)) limited = { dir, max }
  }
  const dir = limited?.dir ?? dirs.find((d) => parseCount(read(`${d}/pids.current`)) !== undefined)
  return {
    pidsMax: limited?.max,
    pidsCurrent: dir === undefined ? undefined : parseCount(read(`${dir}/pids.current`)),
    pidsPeak: dir === undefined ? undefined : parseCount(read(`${dir}/pids.peak`)),
    refusals: dir === undefined ? undefined : parsePidsEvents(read(`${dir}/pids.events`)),
    userProcessLimit: parseUserProcessLimit(read("/proc/self/limits")),
  }
}

/** The threads of every process of one program. */
export interface ProgramThreads {
  readonly program: string
  readonly processes: number
  readonly threads: number
}

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/**
 * What a process is, from its command line: the program's name, with the
 * script a `node` runs (`node render-worker.js`) and the role a browser
 * process states (`chrome-headless-shell (renderer)`) — the two programs here
 * that run as several processes doing different work. Pure.
 */
export function programLabel(argv: readonly string[], fallback: string): string {
  const program = baseName(argv[0] ?? "") || fallback
  if (program === "node") {
    const script = argv.slice(1).find((arg) => arg !== "" && !arg.startsWith("-"))
    return script === undefined ? program : `node ${baseName(script)}`
  }
  const role = argv.find((arg) => arg.startsWith("--type="))
  return role === undefined ? program : `${program} (${role.slice("--type=".length)})`
}

/**
 * The threads each program in this container holds, most first. Read from
 * /proc, so it sees what the process limit counts: every process this one can
 * see. A process that ends while it is read is left out.
 */
export function threadCensus(read: ReadText = readText, list: ListDir = listDir): ProgramThreads[] {
  const byProgram = new Map<string, { processes: number; threads: number }>()
  for (const entry of list("/proc")) {
    if (!/^\d+$/.test(entry)) continue
    const status = read(`/proc/${entry}/status`)
    const threads = parseCount(status?.split("\n").find((l) => l.startsWith("Threads:"))?.slice("Threads:".length))
    if (status === undefined || threads === undefined) continue
    const name = status.split("\n").find((l) => l.startsWith("Name:"))?.slice("Name:".length).trim() || "?"
    const argv = (read(`/proc/${entry}/cmdline`) ?? "").split("\0").filter((arg) => arg !== "")
    const program = programLabel(argv, name)
    const held = byProgram.get(program) ?? { processes: 0, threads: 0 }
    byProgram.set(program, { processes: held.processes + 1, threads: held.threads + threads })
  }
  return [...byProgram.entries()]
    .map(([program, held]) => ({ program, ...held }))
    .sort((a, b) => b.threads - a.threads || a.program.localeCompare(b.program))
}

/** `chrome-headless-shell (renderer) ×10: 141, ffmpeg ×2: 88, … (512 threads in 31 processes)`. Pure. */
export function describeThreadCensus(census: readonly ProgramThreads[], top = 8): string {
  if (census.length === 0) return "no process could be read"
  const shown = census.slice(0, top).map((p) => `${p.program}${p.processes > 1 ? ` ×${p.processes}` : ""}: ${p.threads}`)
  const rest = census.slice(top)
  const others = rest.length > 0 ? `, ${rest.length} more: ${rest.reduce((sum, p) => sum + p.threads, 0)}` : ""
  const threads = census.reduce((sum, p) => sum + p.threads, 0)
  const processes = census.reduce((sum, p) => sum + p.processes, 0)
  return `${shown.join(", ")}${others} (${threads} threads in ${processes} processes)`
}

const orUnknown = (value: number | undefined, unknown: string): string => (value === undefined ? unknown : String(value))

/** The limits in one sentence, for a log line. Pure. */
export function describeProcessLimits(
  limits: ProcessLimits,
  box: { readonly visibleCpus: number; readonly cpuQuota: number | undefined },
): string {
  const container = limits.pidsMax === undefined
    ? `no process limit on the container (${orUnknown(limits.pidsCurrent, "an unknown number of")} processes and threads now)`
    : `the container is limited to ${limits.pidsMax} processes and threads together (pids.max): ${orUnknown(limits.pidsCurrent, "?")} now` +
      `${limits.pidsPeak === undefined ? "" : `, ${limits.pidsPeak} at most so far`}, ${orUnknown(limits.refusals, "an unknown number")} refused so far`
  const user = `per-user limit ${orUnknown(limits.userProcessLimit, "none")}`
  const cpu = `${box.visibleCpus} CPUs visible, CPU quota ${box.cpuQuota === undefined ? "none" : Number(box.cpuQuota.toFixed(2))}`
  return `${container}; ${user}; ${cpu}`
}

/** The limits of THIS box in one sentence. */
export function processLimitsLine(read: ReadText = readText): string {
  return describeProcessLimits(readProcessLimits(read), {
    visibleCpus: affinityCpuCount(read) ?? cpus().length,
    cpuQuota: cgroupCpuQuota(read),
  })
}
