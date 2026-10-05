/**
 * How many threads an ffmpeg render may use — sized to the CPUs this process
 * may actually USE, not the cores it can SEE.
 *
 * WHY. A container's CPU limit is a CFS quota (cgroup `cpu.max`), but the
 * kernel still shows it every core of the host: a 2-vCPU box on the Railway
 * pool reports `nproc` = 48. ffmpeg's "auto" threading counts the cores it can
 * see, so on that box a 4K final ran libx264 with 67 frame threads (x264's
 * 1.5 × cores, capped at two macroblock rows per thread — its own SEI in the
 * output says `threads=67`), the h264 decoder with 16 frame threads and the
 * filter graph with 48, all on two CPUs. Each x264 frame thread holds frames
 * of its own, so memory followed the thread count, not the work. Measured
 * there on the pinned build on 2026-10-04:
 *   - a 6-segment 4K30 final, one chunk: peak 6.8 GiB with auto threads,
 *     2.1 GiB with only x264's count at the quota, 1.8 GiB with every count
 *     at it, and 18 % faster (153 s vs 187 s);
 *   - a dense 4K30 final (60 segments, two 30-segment chunks): OOM-killed in
 *     its first chunk at about 7 GiB with auto threads; complete with every
 *     count at the quota, peaking at 3.5 GiB;
 *   - 1080p finals and proxies (clean, light and heavy grain, three-camera
 *     multicam): 9–22 % faster in 45–63 % less memory, files 1–10 % smaller.
 * The decoder's and the filter graph's counts alone barely move it; x264's is
 * the one that matters. Every count at 2 renders as fast (within 3 %) as the
 * libraries' own rule for two CPUs (decoder 3, x264 3), in 2–8 % less memory.
 *
 * The quota is the real budget. When it is below the cores ffmpeg would count,
 * every ffmpeg the backend runs is told explicitly (decided 2026-10-05): the
 * one launcher, `ffmpeg-process.ts`, places the counts into each argv
 * (`withFfmpegThreads`, below), and an Apply EDL slice binds its own
 * (`sliceArgv` in `apply-edl.ts`, whose resume key hashes them). When there is
 * no quota (or it is at least that many cores), ffmpeg's own detection is
 * already right and nothing is passed — every render is exactly what it was.
 *
 * A dependency-free leaf (node:fs, node:os): pure parsers plus one reader with
 * an injectable file source, so every branch is tested without a cgroup.
 */
import { readFileSync } from "node:fs"
import { cpus } from "node:os"

/** cgroup v2 `cpu.max` — `"<quota> <period>"`, or `"max <period>"` when
 *  unlimited — as CPUs (quota ÷ period); undefined when unlimited or not a
 *  quota at all. */
export function parseCpuMax(text: string): number | undefined {
  const [quota, period] = text.trim().split(/\s+/)
  if (!quota || quota === "max") return undefined
  return ratio(Number(quota), Number(period ?? "100000"))
}

/** cgroup v1 `cpu.cfs_quota_us` / `cpu.cfs_period_us` as CPUs; undefined for
 *  the unlimited quota (-1) or anything unreadable. */
export function parseCfsQuota(quotaUs: string, periodUs: string): number | undefined {
  return ratio(Number(quotaUs.trim()), Number(periodUs.trim()))
}

const ratio = (quota: number, period: number): number | undefined =>
  Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0 ? quota / period : undefined

/** Reads a text file, or undefined when it does not exist or cannot be read. */
export type ReadText = (path: string) => string | undefined

const readText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/**
 * This process's CPU quota in CPUs, or undefined when it has none.
 *
 * cgroup v2: the tightest `cpu.max` from the process's own cgroup
 * (`/proc/self/cgroup`, `0::<path>`) up to the mount root — a parent's quota
 * binds as much as its own. With a private cgroup namespace (Docker's default)
 * the path is `/` and that is the container's own `cpu.max`; with a host
 * namespace the container's cgroup is mounted at the root, its full path does
 * not exist under it, and the walk reaches it all the same. Else cgroup v1's
 * CFS quota.
 */
export function cgroupCpuQuota(read: ReadText = readText): number | undefined {
  const self = read("/proc/self/cgroup") ?? ""
  const v2 = self.split("\n").find((line) => line.startsWith("0::"))
  if (v2 !== undefined) {
    let rel = v2.slice(3).trim() || "/"
    let tightest: number | undefined
    for (;;) {
      const text = read(`/sys/fs/cgroup${rel === "/" ? "" : rel}/cpu.max`)
      const quota = text === undefined ? undefined : parseCpuMax(text)
      if (quota !== undefined) tightest = tightest === undefined ? quota : Math.min(tightest, quota)
      if (rel === "/") break
      rel = rel.slice(0, rel.lastIndexOf("/")) || "/"
    }
    if (tightest !== undefined) return tightest
  }
  for (const dir of ["/sys/fs/cgroup/cpu", "/sys/fs/cgroup/cpu,cpuacct"]) {
    const quota = read(`${dir}/cpu.cfs_quota_us`)
    const period = read(`${dir}/cpu.cfs_period_us`)
    const cpusOf = quota !== undefined && period !== undefined ? parseCfsQuota(quota, period) : undefined
    if (cpusOf !== undefined) return cpusOf
  }
  return undefined
}

/** The CPUs a process may use, for ffmpeg: its cgroup `quota` rounded UP (a
 *  1.5-CPU quota still runs two threads at once), never more than the CPUs the
 *  scheduler lets it run on (`schedulable`). `undefined` when there is no quota
 *  below the cores ffmpeg would count itself (`seenByFfmpeg` — the host's
 *  cores, which ffmpeg and x264 read without regard to any quota): its own
 *  detection is then already the budget. Pure, every input explicit — no
 *  defaults, so an explicit `undefined` quota means "none", never "read this
 *  box" (`ffmpegThreads` reads the box). */
export function ffmpegCpuBudget(
  quota: number | undefined,
  schedulable: number,
  seenByFfmpeg: number,
): number | undefined {
  if (quota === undefined) return undefined
  const budget = Math.max(1, Math.min(Math.ceil(quota), Math.floor(schedulable)))
  return budget < seenByFfmpeg ? budget : undefined
}

/** Explicit thread counts for one ffmpeg render. */
export interface FfmpegThreads {
  /** Each input's decoder (`-threads` before its `-i`). */
  readonly decode: number
  /** The `-filter_complex` graph's worker threads. */
  readonly filter: number
  /** The output's encoders (`-threads` before the output path) — libx264's
   *  frame threads, the one count whose memory scales with the picture. */
  readonly encode: number
}

/** The thread counts for a CPU budget — every part of the render gets the
 *  budget, never the host's core count. */
export function ffmpegThreadsFor(budget: number): FfmpegThreads {
  const n = Math.max(1, Math.floor(budget))
  return { decode: n, filter: n, encode: n }
}

/** The number of CPUs in a kernel CPU list (`0-3,8,10-11`), or undefined
 *  when it is not one. */
export function parseCpuList(text: string): number | undefined {
  const parts = text.trim().split(",").filter(Boolean)
  if (parts.length === 0) return undefined
  let count = 0
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    if (!m) return undefined
    const lo = Number(m[1])
    const hi = m[2] === undefined ? lo : Number(m[2])
    if (hi < lo) return undefined
    count += hi - lo + 1
  }
  return count
}

/** The CPUs this process may run on — its affinity mask, `Cpus_allowed_list`
 *  in `/proc/self/status`: what `nproc` prints, and what ffmpeg and x264
 *  count. Undefined when it cannot be read (not Linux). */
export function affinityCpuCount(read: ReadText = readText): number | undefined {
  const status = read("/proc/self/status")
  const line = status?.split("\n").find((l) => l.startsWith("Cpus_allowed_list:"))
  return line === undefined ? undefined : parseCpuList(line.slice("Cpus_allowed_list:".length))
}

/** The render's thread counts on THIS box, or undefined (let ffmpeg decide —
 *  it already sees the right number of CPUs). Read once per render.
 *
 *  Both the scheduler cap and "the cores ffmpeg sees" are the affinity mask
 *  (decided 2026-10-05). Not `availableParallelism()`: on the Node we deploy
 *  it already floors a fractional quota (1.5 → 1), which would undo the
 *  round-up. Not `cpus().length`: it counts every host CPU, including ones
 *  this process may not run on. `cpus()` is only the fallback off Linux. */
export function ffmpegThreads(read: ReadText = readText): FfmpegThreads | undefined {
  const allowed = affinityCpuCount(read) ?? cpus().length
  const budget = ffmpegCpuBudget(cgroupCpuQuota(read), allowed, allowed)
  return budget === undefined ? undefined : ffmpegThreadsFor(budget)
}

// ── Placing the counts into an argv ─────────────────────────────────────────
//
// Every ffmpeg the backend runs gets the counts (decided 2026-10-05), most of
// them through argv their callers build by hand — so the counts are placed by
// READING that argv the way ffmpeg's command-line splitter does
// (`split_commandline`, fftools/cmdutils.c): a non-option token (or a bare
// `-`) is an output path; `-i` takes its input; an option ffmpeg knows as
// valueless takes nothing; every other option — its own or an AVOption passed
// through to a codec, format or filter — takes exactly the next token, even
// one that starts with a dash (`-sseof -1`). Options are named up to a `:`
// stream specifier, after an optional `-/` file prefix.

/** ffmpeg's OPT_TYPE_BOOL options (fftools/ffmpeg_opt.c and opt_common.h at
 *  n8.1.2, the production pin): they take no value, and each also has a
 *  valueless `-no<name>` form. */
const FFMPEG_BOOL_OPTIONS: ReadonlySet<string> = new Set([
  "y", "n", "ignore_unknown", "copy_unknown", "recast_media", "accurate_seek", "benchmark", "benchmark_all",
  "stdin", "dump", "hex", "re", "copyts", "start_at_zero", "shortest", "bitexact", "xerror", "copyinkf",
  "print_graphs", "auto_conversion_filters", "stats", "debug_ts", "find_stream_info", "display_hflip",
  "display_vflip", "vn", "force_fps", "autorotate", "autoscale", "fix_sub_duration_heartbeat", "an", "sn",
  "fix_sub_duration", "dn", "hide_banner",
])

/** ffmpeg's function options that take no value (OPT_TYPE_FUNC without
 *  OPT_FUNC_ARG, and not exiting). `qphist` is gone in ffmpeg 9. */
const FFMPEG_VALUELESS_FUNC_OPTIONS: ReadonlySet<string> = new Set(["vstats", "report", "qphist"])

/** ffmpeg's informational options (OPT_EXIT): it prints and exits, nothing is
 *  rendered. An argv with one is never threaded — `-version`'s first line keys
 *  render caches (`ffmpegVersionLine`). */
const FFMPEG_EXIT_OPTIONS: ReadonlySet<string> = new Set([
  "hwaccels", "sources", "sinks", "L", "license", "h", "?", "help", "-help", "version", "buildconf", "formats",
  "muxers", "demuxers", "devices", "codecs", "decoders", "encoders", "bsfs", "protocols", "filters", "pix_fmts",
  "layouts", "sample_fmts", "dispositions", "colors",
])

/** Options that set a thread count. An argv that already names one decided
 *  its own counts (Apply EDL's `sliceArgv`, whose resume key hashes them). */
const THREAD_OPTIONS: ReadonlySet<string> = new Set(["threads", "filter_threads", "filter_complex_threads"])

/** A value that reads as an option name: ffmpeg's values never look like this
 *  in practice (negative numbers and `-` do not), so finding one where a value
 *  is due means an option was misread — a valueless one this table does not
 *  know, or a dangling one. */
const OPTION_LIKE = /^-[A-Za-z_/?]/

/** Where ffmpeg would see each file of `args`: the index of every `-i` and of
 *  every output path. Undefined when the argv must be left as given: an
 *  informational run, one that sets its own thread counts, one with no output,
 *  or one it cannot read for certain (`--`, a value that looks like an option,
 *  a dangling option). */
function ffmpegFileTokens(args: readonly string[]): { inputs: number[]; outputs: number[] } | undefined {
  const inputs: number[] = []
  const outputs: number[] = []
  for (let k = 0; k < args.length; k++) {
    const token = args[k]!
    if (token === "--") return undefined
    if (!token.startsWith("-") || token === "-") {
      outputs.push(k)
      continue
    }
    const raw = token.slice(1)
    if (raw === "i" || raw === "dec") {
      // Group separators (`-dec` opens a loopback decoder) — each takes a value.
      const value = args[k + 1]
      if (value === undefined || OPTION_LIKE.test(value)) return undefined
      if (raw === "i") inputs.push(k)
      k++
      continue
    }
    const name = (raw.startsWith("/") ? raw.slice(1) : raw).split(":")[0]!
    if (FFMPEG_EXIT_OPTIONS.has(name) || THREAD_OPTIONS.has(name)) return undefined
    if (FFMPEG_BOOL_OPTIONS.has(name) || FFMPEG_VALUELESS_FUNC_OPTIONS.has(name)) continue
    if (name.startsWith("no") && FFMPEG_BOOL_OPTIONS.has(name.slice(2))) continue
    const value = args[k + 1]
    if (value === undefined || OPTION_LIKE.test(value)) return undefined
    k++
  }
  return outputs.length > 0 ? { inputs, outputs } : undefined
}

/**
 * `args` with `threads` placed where ffmpeg binds each count: the filter
 * graphs' (`-filter_complex_threads` and `-filter_threads` for a simple
 * `-vf`/`-af` graph — global, first), each input's decoders (`-threads`
 * before its `-i`) and each output's encoders (`-threads` before its path —
 * libx264's frame threads, the count whose memory scales with the picture).
 * Without `threads` (no quota below the cores ffmpeg counts — `ffmpegThreads`),
 * or for an argv it leaves alone (`ffmpegFileTokens`), a copy of `args` as
 * given. Pure.
 */
export function withFfmpegThreads(args: readonly string[], threads: FfmpegThreads | undefined): string[] {
  const files = threads ? ffmpegFileTokens(args) : undefined
  if (!threads || !files) return [...args]
  const inputs = new Set(files.inputs)
  const outputs = new Set(files.outputs)
  const out = ["-filter_complex_threads", String(threads.filter), "-filter_threads", String(threads.filter)]
  args.forEach((token, k) => {
    if (inputs.has(k)) out.push("-threads", String(threads.decode))
    if (outputs.has(k)) out.push("-threads", String(threads.encode))
    out.push(token)
  })
  return out
}
