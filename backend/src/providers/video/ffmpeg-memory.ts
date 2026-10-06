/**
 * How much memory the ffmpeg launches of this process may reserve between
 * them — the budget the launcher's admission (`ffmpeg-admission.ts`) spends
 * (decided 2026-10-05, fixing the 4K OOM).
 *
 * WHY. Memory adds up with no sharing: on the Railway nodaro-ci runner (2 vCPU
 * quota, memory.max 7,629 MiB, ffmpeg n8.1.2 with the quota's thread counts)
 * two 30-segment 4K Apply EDL finals at once reached 7,427 MiB of cgroup anon
 * and one was OOM-killed; two at 25 segments survived at 6,766 MiB. The box
 * held about 255–270 MiB of idle anon, so its usable ceiling was ~7,400 MiB.
 *
 *   budget = (limit − reserve) × headroom
 *
 * `limit` is the container's memory limit — cgroup v2 `memory.max` (the
 * tightest on this process's cgroup path), else cgroup v1
 * `memory.limit_in_bytes` — never more than the host's memory. With no limit
 * (`max`, v1's page-counter maximum, or nothing readable) it is the configured
 * `FFMPEG_MEMORY_LIMIT_MIB`, else the host's memory (`os.totalmem()`): a box is
 * never "unlimited" by accident. `reserve` (default 2,048 MiB) is for the Node
 * processes and everything else in the container. Measured (decided 2026-10-05)
 * on IDLE containers: `memory.current` 1.66 GB on staging and 1.9 GB on
 * production — that figure includes page cache, so it is a ceiling for what the
 * processes themselves hold, and a deliberately safe one to reserve against.
 * `headroom` (default 0.9) absorbs prediction error and what nothing predicts.
 * On the measured runner: (7,629 − 2,048) × 0.9 = 5,022 MiB; on production's
 * 32,000,000,000-byte container: (30,517 − 2,048) × 0.9 = 25,622 MiB.
 *
 * A launch that predicts nothing reserves the model's default estimate
 * (`ffmpeg-memory-model.ts`: 393 + 22.9·T MiB, T its thread count — 1,126 MiB at
 * the 32 threads production gives every ffmpeg); `FFMPEG_DEFAULT_PEAK_MIB`,
 * when set, replaces it with one fixed figure.
 *
 * ONE BUDGET PER CONTAINER: a Railway container runs four processes (server,
 * worker, render-worker, orchestrator) under ONE memory limit, so the budget is
 * spent from a shared ledger (`ffmpeg-memory-ledger.ts`), not per process. When
 * the ledger is unreachable a process falls back to `localShare` of this
 * budget (`FFMPEG_MEMORY_LOCAL_SHARE`, default 0.5: the heavy renders run in
 * two of the four processes — the video worker and the render worker — so half
 * each can never sum past the whole; the server's lighter in-process launches
 * are the residual).
 *
 * A dependency-free leaf like `ffmpeg-threads.ts`: pure parsers, one reader
 * with an injectable file source, and the settings passed in explicitly — the
 * defaults live HERE, and `config` only carries what an operator set.
 */
import { totalmem } from "node:os"
import { readFileSync } from "node:fs"
import type { ReadText } from "./ffmpeg-threads.js"

const MIB = 1024 * 1024

/** The defaults an unset (or invalid) setting falls back to. */
export const FFMPEG_MEMORY_DEFAULTS = { reserveMiB: 2048, headroom: 0.9, localShare: 0.5 } as const

/** What an operator may set (`FFMPEG_MEMORY_*`); anything unset or invalid
 *  takes its default. */
export interface FfmpegMemorySettings {
  /** The limit to assume when the container has none (`FFMPEG_MEMORY_LIMIT_MIB`). */
  readonly fallbackLimitMiB?: number
  /** Kept back for Node and the rest of the container (`FFMPEG_MEMORY_RESERVE_MIB`). */
  readonly reserveMiB?: number
  /** The share of what is left that ffmpeg may reserve, in (0, 1] (`FFMPEG_MEMORY_HEADROOM`). */
  readonly headroom?: number
  /** One fixed figure for a launch that predicts nothing (`FFMPEG_DEFAULT_PEAK_MIB`);
   *  unset, the thread-scaled estimate of `ffmpeg-memory-model.ts` stands. */
  readonly defaultPeakMiB?: number
  /** The share of the budget one process may spend while the shared ledger is
   *  unreachable, in (0, 1] (`FFMPEG_MEMORY_LOCAL_SHARE`). */
  readonly localShare?: number
}

export interface FfmpegMemoryBudget {
  /** What all running ffmpeg launches may reserve together, in MiB (≥ 0). */
  readonly budgetMiB: number
  /** The limit the budget was taken from, in MiB. */
  readonly limitMiB: number
  readonly limitSource: "cgroup-v2" | "cgroup-v1" | "configured" | "host"
  readonly reserveMiB: number
  readonly headroom: number
  /** A fixed estimate for an unpredicted launch, when the operator set one. */
  readonly defaultPeakOverrideMiB: number | undefined
  readonly localShare: number
  /** What this process may reserve alone while the ledger is down. */
  readonly localBudgetMiB: number
}

/** cgroup v2 `memory.max` in bytes; undefined for `max` (no limit) or
 *  anything that is not a positive number. */
export function parseMemoryMax(text: string): number | undefined {
  const value = text.trim()
  if (!/^\d+$/.test(value)) return undefined
  const bytes = Number(value)
  return bytes > 0 && Number.isFinite(bytes) ? bytes : undefined
}

/** cgroup v1 `memory.limit_in_bytes` in bytes; undefined for v1's "unlimited"
 *  — the page-counter maximum, 9223372036854771712 on 4-KiB pages, reported as
 *  a number — or anything unreadable. */
export function parseCgroupV1MemoryLimit(text: string): number | undefined {
  const bytes = parseMemoryMax(text)
  return bytes === undefined || bytes >= 2 ** 60 ? undefined : bytes
}

const readText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/**
 * This process's memory limit, or undefined when it has none.
 *
 * cgroup v2: the tightest `memory.max` from the process's own cgroup
 * (`/proc/self/cgroup`, `0::<path>`) up to the mount root, walked like
 * `cgroupCpuQuota` — a parent's limit binds as much as its own. Else cgroup
 * v1's `memory.limit_in_bytes`.
 */
export function cgroupMemoryLimitBytes(
  read: ReadText = readText,
): { readonly bytes: number; readonly source: "cgroup-v2" | "cgroup-v1" } | undefined {
  const self = read("/proc/self/cgroup") ?? ""
  const v2 = self.split("\n").find((line) => line.startsWith("0::"))
  if (v2 !== undefined) {
    let rel = v2.slice(3).trim() || "/"
    let tightest: number | undefined
    for (;;) {
      const text = read(`/sys/fs/cgroup${rel === "/" ? "" : rel}/memory.max`)
      const bytes = text === undefined ? undefined : parseMemoryMax(text)
      if (bytes !== undefined) tightest = tightest === undefined ? bytes : Math.min(tightest, bytes)
      if (rel === "/") break
      rel = rel.slice(0, rel.lastIndexOf("/")) || "/"
    }
    if (tightest !== undefined) return { bytes: tightest, source: "cgroup-v2" }
  }
  const v1 = read("/sys/fs/cgroup/memory/memory.limit_in_bytes")
  const bytes = v1 === undefined ? undefined : parseCgroupV1MemoryLimit(v1)
  return bytes === undefined ? undefined : { bytes, source: "cgroup-v1" }
}

const positive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
const nonNegative = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

/** The budget for `settings` on the box `read` and `hostBytes` describe. */
export function ffmpegMemoryBudget(
  settings: FfmpegMemorySettings,
  read: ReadText = readText,
  hostBytes: number = totalmem(),
): FfmpegMemoryBudget {
  const reserveMiB = nonNegative(settings.reserveMiB) ? settings.reserveMiB : FFMPEG_MEMORY_DEFAULTS.reserveMiB
  const headroom = positive(settings.headroom) && settings.headroom <= 1 ? settings.headroom : FFMPEG_MEMORY_DEFAULTS.headroom
  const defaultPeakOverrideMiB = positive(settings.defaultPeakMiB) ? Math.ceil(settings.defaultPeakMiB) : undefined
  const localShare = positive(settings.localShare) && settings.localShare <= 1 ? settings.localShare : FFMPEG_MEMORY_DEFAULTS.localShare
  const hostMiB = Math.floor(hostBytes / MIB)
  const cgroup = cgroupMemoryLimitBytes(read)
  let limitMiB: number
  let limitSource: FfmpegMemoryBudget["limitSource"]
  if (cgroup) {
    const cgroupMiB = Math.floor(cgroup.bytes / MIB)
    limitMiB = Math.min(cgroupMiB, hostMiB)
    limitSource = cgroupMiB <= hostMiB ? cgroup.source : "host"
  } else if (positive(settings.fallbackLimitMiB)) {
    limitMiB = Math.floor(settings.fallbackLimitMiB)
    limitSource = "configured"
  } else {
    limitMiB = hostMiB
    limitSource = "host"
  }
  const budgetMiB = Math.max(0, Math.floor((limitMiB - reserveMiB) * headroom))
  return {
    budgetMiB, limitMiB, limitSource, reserveMiB, headroom, defaultPeakOverrideMiB, localShare,
    localBudgetMiB: Math.floor(budgetMiB * localShare),
  }
}

let onThisBox: FfmpegMemoryBudget | undefined

/** This box's budget, read once per process — a container's memory limit does
 *  not change while it runs. */
export function ffmpegMemoryBudgetOnThisBox(settings: FfmpegMemorySettings): FfmpegMemoryBudget {
  onThisBox ??= ffmpegMemoryBudget(settings)
  return onThisBox
}

/** One log line naming the budget and where it came from. */
export function describeFfmpegMemoryBudget(budget: FfmpegMemoryBudget): string {
  const unpredicted = budget.defaultPeakOverrideMiB === undefined
    ? "an unpredicted launch reserves 393 + 22.9·threads MiB"
    : `an unpredicted launch reserves ${budget.defaultPeakOverrideMiB} MiB`
  return (
    `ffmpeg memory budget ${budget.budgetMiB} MiB = (${budget.limitMiB} MiB ${budget.limitSource} limit − ` +
    `${budget.reserveMiB} MiB reserve) × ${budget.headroom}, shared by the container's processes ` +
    `(${budget.localBudgetMiB} MiB each if the ledger is down); ${unpredicted}`
  )
}

/**
 * The container's identity — the key its processes share one ledger under.
 * `RAILWAY_REPLICA_ID` is set per running replica and is the same in every
 * process of it; without it (Docker anywhere else, a dev box) the hostname is
 * the container id on Docker and the machine on a bare host — one container,
 * one hostname, and a different container never shares it. A blank value
 * counts as unset.
 */
export function ffmpegContainerId(
  env: Readonly<Record<string, string | undefined>>,
  hostname: string,
): { readonly id: string; readonly source: "RAILWAY_REPLICA_ID" | "hostname" } {
  const replica = env.RAILWAY_REPLICA_ID?.trim()
  return replica ? { id: replica, source: "RAILWAY_REPLICA_ID" } : { id: hostname, source: "hostname" }
}
