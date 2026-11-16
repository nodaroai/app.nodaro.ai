/**
 * The network guard for ffprobe reading a link someone gave us.
 *
 * ffprobe does its own DNS and its own HTTP, so it never passes through
 * `safeFetch`. Two layers keep it to public addresses:
 *
 * 1. **The first hop** (`assertSafeProbeSource`): before ffprobe starts, the
 *    link must be an http(s) link both URL parsers read alike, whose host is
 *    not (and does not resolve to) a private or reserved address. Its typed
 *    refusal (`ProbeSourceBlockedError`) is what callers read.
 * 2. **Every connection ffprobe makes** (`openProbeEgress`): ffprobe runs with
 *    `http_proxy` pointing at a proxy of our own, on 127.0.0.1, that lives for
 *    that one run. ffmpeg sends every http request through it and opens every
 *    https connection as a CONNECT tunnel through it — the first hop, each
 *    redirect it follows, each range request, and each link a playlist or
 *    manifest inside the file names (HLS, DASH, IMF). For each one the proxy
 *    resolves the host once with the same rule as the first hop
 *    (`checkProbeHost`) and connects to exactly the address it checked, so a
 *    host that answers our lookup and ffprobe's differently (DNS rebinding) is
 *    caught too. A refused hop answers 403, and the run's refusal is recorded
 *    so the probe throws the same `ProbeSourceBlockedError` the first hop
 *    would have.
 *
 * ffprobe still follows redirects, keeps cookies and makes its range requests
 * itself, exactly as without the proxy (an https tunnel is passed through byte
 * for byte), so a public link reads as it always has. The redirect limit is
 * ffmpeg's own default, stated explicitly (`PROBE_MAX_REDIRECTS`).
 *
 * 3. **Ordinary media files only** (`REMOTE_PROBE_FORMATS`): a link is read
 *    only by a demuxer that reads the file itself (`SINGLE_FILE_DEMUXERS`), so
 *    a streaming playlist, a manifest or a concat script (HLS, DASH, IMF,
 *    ffconcat) is refused before any link inside it is opened — whether that
 *    link would have gone through the proxy or named a raw transport the proxy
 *    never sees (`tcp://`, `httpproxy://`). The refusal is typed (reason
 *    `container`) and the routes answer it with {@link NOT_A_MEDIA_FILE}.
 */
import http from "node:http"
import net from "node:net"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { lookup as dnsLookup } from "node:dns/promises"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { hasUrlParserHazard } from "@nodaro/shared/video"
import { SINGLE_FILE_DEMUXERS } from "./single-file-demuxers.js"
import { isNetworkProbeSource, namesALink, optionFileProblem } from "./link-arguments.js"

/**
 * Why a probe link was refused: `address` — it is, or its host resolves to, a
 * private or reserved address (at the first hop or at any later one: a
 * redirect, a link inside a playlist); `host` — its host does not exist (no
 * such domain, or an answer with no address); `dns` — its host could not be
 * resolved for another reason (a timeout, a failing resolver: possibly for a
 * moment, so a caller may treat it as retryable); `link` — not an http(s) link
 * both URL parsers read alike; `container` — the link is not an ordinary media
 * file (a streaming playlist, a manifest, a concat script: `REMOTE_PROBE_FORMATS`).
 * The message and the error's name are the ones the guard has always thrown,
 * so a caller that reads only those sees no difference.
 */
export type ProbeSourceBlockReason = "address" | "host" | "dns" | "link" | "container"

export class ProbeSourceBlockedError extends Error {
  constructor(readonly reason: ProbeSourceBlockReason, message: string) {
    super(message)
  }
}

/** One address a host resolved to. */
export interface ProbeAddress {
  readonly address: string
  readonly family: number
}

/**
 * How the guard resolves a host and judges an address — the same for the first
 * hop and for every hop the proxy sees. A test replaces these (`vi.spyOn`) to
 * stand a local server in for a public one.
 */
/**
 * The size of this process's libuv threadpool, read the way libuv reads it when
 * the pool starts: `UV_THREADPOOL_SIZE` (leading digits; 0 or none is 1, at most
 * 1024), or 4 when it is not set. The image sets 16 (Dockerfile).
 */
export function libuvPoolSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.UV_THREADPOOL_SIZE
  if (raw === undefined || raw === "") return 4
  const n = Number.parseInt(raw, 10)
  return Math.min(1024, Number.isInteger(n) && n > 0 ? n : 1)
}

/**
 * The guard's lookup caps for a pool of `poolSize` threads: at most a quarter
 * of it, active plus abandoned, so the guard's lookups can never stall the
 * rest of the process (file, crypto and zlib work, and every other
 * connection's lookup). The image's 16 threads give 3 active and 1 abandoned;
 * Node's default 4 gives 1 active and none abandoned, so a host that never
 * answers then holds the one slot until its resolver gives up, and the other
 * links' lookups wait and are refused as retryable meanwhile.
 */
export function guardLookupCaps(poolSize: number): { readonly maxActiveLookups: number; readonly maxAbandonedLookups: number } {
  const total = Math.max(1, Math.floor(poolSize / 4))
  const abandoned = Math.floor(total / 4)
  return { maxActiveLookups: total - abandoned, maxAbandonedLookups: abandoned }
}

/** The caps of this process, read once at start (the pool's size cannot change after it starts). */
const PROCESS_LOOKUP_CAPS = guardLookupCaps(libuvPoolSize())

export const probeNetwork = {
  lookup: (host: string): Promise<ProbeAddress[]> => dnsLookup(host, { all: true, verbatim: true }),
  isRefusedAddress: (ip: string): boolean => isPrivateOrReservedIP(ip),
  /** How long one lookup may take, its wait for a slot included: past it the hop is refused as `dns` (retryable). */
  lookupTimeoutMs: 5_000,
  /**
   * How many lookups may run within their time at once, across all hosts. One
   * host runs one lookup at a time (concurrent lookups of it share the call),
   * so a host whose resolver never answers holds one slot at most.
   */
  maxActiveLookups: PROCESS_LOOKUP_CAPS.maxActiveLookups,
  /**
   * How many lookups past their time may still be running. `dns.lookup` is the
   * system resolver (getaddrinfo: the hosts file and the system's order, the
   * answer the first hop, safeFetch and ffprobe have always used); it runs in
   * the process's libuv threadpool (shared with file, crypto and zlib work and
   * every other connection's lookup) and cannot be cancelled. A lookup past its
   * time is abandoned — it stops counting against `maxActiveLookups` for other
   * hosts — while it still holds a thread, up to this cap; past the cap an
   * overdue lookup keeps its slot. So the guard holds at most
   * `maxActiveLookups + maxAbandonedLookups` threads, whatever it is asked: a
   * quarter of the pool (`guardLookupCaps`).
   */
  maxAbandonedLookups: PROCESS_LOOKUP_CAPS.maxAbandonedLookups,
  /** How long an allowed answer is reused (the connection always goes to the checked address). */
  answerCacheMs: 30_000,
}

/** One host's call to the resolver, shared by every lookup of that host while it runs. */
interface HostLookup {
  readonly host: string
  readonly answer: Promise<ProbeAddress[]>
  /** Past its time: a new lookup of the host fails fast. */
  overdue: boolean
  /** Moved off the active slots into the abandoned cap. */
  abandoned: boolean
}

const lookupsByHost = new Map<string, HostLookup>()
let activeLookups = 0
let abandonedLookups = 0
/** Lookups waiting for an active slot, oldest first. */
const slotWaiters: Array<() => void> = []
/** Overdue lookups still holding an active slot, waiting for room in the abandoned cap. */
const overdueActive: HostLookup[] = []
/** Allowed answers, by host, until when they are reused. */
const allowedAnswers = new Map<string, { readonly addrs: readonly ProbeAddress[]; readonly until: number }>()
const ALLOWED_ANSWERS_MAX = 1_000

/** The scheduler's load (tests, and anyone asking how busy the guard's resolver is). */
export function probeLookupLoad(): { active: number; abandoned: number; waiting: number } {
  return { active: activeLookups, abandoned: abandonedLookups, waiting: slotWaiters.length }
}

function grantSlots(): void {
  while (activeLookups < probeNetwork.maxActiveLookups && slotWaiters.length > 0) {
    activeLookups++
    slotWaiters.shift()!()
  }
}

/** Move `entry` off the active slots when the abandoned cap has room; true when it moved. */
function abandon(entry: HostLookup): boolean {
  if (entry.abandoned || abandonedLookups >= probeNetwork.maxAbandonedLookups) return false
  entry.abandoned = true
  abandonedLookups++
  activeLookups--
  grantSlots()
  return true
}

/** `entry` ran out of time: overdue, and abandoned when the cap has room (else it keeps its slot until it can be). */
function markOverdue(entry: HostLookup): void {
  if (entry.overdue || lookupsByHost.get(entry.host) !== entry) return
  entry.overdue = true
  if (!abandon(entry)) overdueActive.push(entry)
}

/** The resolver answered `entry` (however late): free what it held, and let an overdue lookup take an abandoned place. */
function settleLookup(entry: HostLookup): void {
  if (lookupsByHost.get(entry.host) === entry) lookupsByHost.delete(entry.host)
  const i = overdueActive.indexOf(entry)
  if (i >= 0) overdueActive.splice(i, 1)
  if (entry.abandoned) abandonedLookups--
  else activeLookups--
  while (overdueActive.length > 0 && abandon(overdueActive[0]!)) overdueActive.shift()
  grantSlots()
}

const outOfTime = (host: string) => Object.assign(new Error(`probe guard: lookup of ${host} timed out`), { code: "ETIMEOUT" })

/**
 * `probeNetwork.lookup(host)` through the scheduler (see `probeNetwork`): one
 * call per host at a time, an active slot for it, and `lookupTimeoutMs` for the
 * wait and the answer together. Past it this rejects `{ code: "ETIMEOUT" }`,
 * which the host check reads as a resolver failure (`dns`, retryable).
 */
async function boundedLookup(host: string): Promise<ProbeAddress[]> {
  const deadlineAt = Date.now() + probeNetwork.lookupTimeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(outOfTime(host)), probeNetwork.lookupTimeoutMs)
  })
  deadline.catch(() => undefined)
  try {
    let entry = lookupsByHost.get(host)
    if (entry?.overdue) throw outOfTime(host) // this host is not answering: fail fast, start nothing
    if (!entry) {
      if (activeLookups < probeNetwork.maxActiveLookups) activeLookups++
      else {
        let granted = false
        let grant!: () => void
        const slot = new Promise<void>((resolve) => {
          grant = () => {
            granted = true
            resolve()
          }
        })
        slotWaiters.push(grant)
        try {
          await Promise.race([slot, deadline])
        } catch (err) {
          // Out of time before a slot came: leave the queue, or hand on a slot granted at that very moment.
          const i = slotWaiters.indexOf(grant)
          if (i >= 0) slotWaiters.splice(i, 1)
          else if (granted) {
            activeLookups--
            grantSlots()
          }
          throw err
        }
      }
      // Another lookup of this host may have started while this one waited: join it, hand the slot on.
      const joined = lookupsByHost.get(host)
      if (joined) {
        activeLookups--
        grantSlots()
        if (joined.overdue) throw outOfTime(host)
        entry = joined
      } else {
        if (Date.now() >= deadlineAt) {
          activeLookups--
          grantSlots()
          throw outOfTime(host)
        }
        const started: HostLookup = { host, answer: Promise.resolve().then(() => probeNetwork.lookup(host)), overdue: false, abandoned: false }
        lookupsByHost.set(host, started)
        void started.answer.then(() => settleLookup(started), () => settleLookup(started))
        // Past its own time (from its start, not its caller's) it is overdue.
        const overdueTimer = setTimeout(() => markOverdue(started), probeNetwork.lookupTimeoutMs)
        overdueTimer.unref?.()
        void started.answer.finally(() => clearTimeout(overdueTimer)).catch(() => undefined)
        entry = started
      }
    }
    // Only the lookup's own timer (from when IT started) marks it overdue: a caller whose time ran out
    // waiting for a slot must not cut short a lookup that has only just begun.
    return await Promise.race([entry.answer, deadline])
  } finally {
    clearTimeout(timer)
  }
}
/**
 * The address rule: a literal private/reserved IP is refused; a hostname is
 * resolved and refused when ANY answer is private/reserved (a host that
 * round-robins between public and private targets is still unsafe), when it
 * does not exist (`host`), or when the lookup fails another way (`dns`).
 * Returns the addresses the host may be reached at, IPv4 first (a host with
 * both stays reachable from a server without IPv6 egress).
 */
export async function checkProbeHost(rawHost: string): Promise<readonly ProbeAddress[]> {
  const host = rawHost.replace(/^\[|\]$/g, "")
  const family = net.isIP(host)
  if (family) {
    if (probeNetwork.isRefusedAddress(host)) {
      throw new ProbeSourceBlockedError("address", `probeVideoSource: blocked private/reserved IP ${host}`)
    }
    return [{ address: host, family }]
  }
  const cached = allowedAnswers.get(host)
  if (cached) {
    // Reused only while reuse is on and fresh, and only while the address rule still allows every address in it.
    if (probeNetwork.answerCacheMs > 0 && cached.until > Date.now() && !cached.addrs.some((a) => probeNetwork.isRefusedAddress(a.address))) return cached.addrs
    allowedAnswers.delete(host)
  }
  let addrs: ProbeAddress[]
  try {
    addrs = await boundedLookup(host)
  } catch (err) {
    // A host that does not exist is for good; any other failure (a timeout, a resolver that failed) may pass.
    const code = (err as { code?: unknown } | null)?.code
    throw new ProbeSourceBlockedError(code === "ENOTFOUND" || code === "ENODATA" ? "host" : "dns", `probeVideoSource: blocked — DNS resolution failed for ${host}`)
  }
  if (addrs.length === 0) {
    throw new ProbeSourceBlockedError("host", `probeVideoSource: blocked — no DNS resolution for ${host}`)
  }
  for (const a of addrs) {
    if (probeNetwork.isRefusedAddress(a.address)) {
      throw new ProbeSourceBlockedError("address", `probeVideoSource: blocked — ${host} resolves to private/reserved IP ${a.address}`)
    }
  }
  const allowed = [...addrs.filter((a) => a.family === 4), ...addrs.filter((a) => a.family !== 4)]
  if (probeNetwork.answerCacheMs > 0) {
    // Only an allowed answer is kept, and the proxy connects to exactly it: reusing it never reaches a refused address.
    allowedAnswers.delete(host)
    allowedAnswers.set(host, { addrs: allowed, until: Date.now() + probeNetwork.answerCacheMs })
    if (allowedAnswers.size > ALLOWED_ANSWERS_MAX) allowedAnswers.delete(allowedAnswers.keys().next().value!)
  }
  return allowed
}

// How an argv names a link (as written, in filter escaping, or in a file an option reads): `link-arguments.ts`.
export { isNetworkProbeSource, namesALink }

/**
 * The refusal (reason `link`) of a run whose option reads its value from a
 * file that names a link, or from anything this check cannot read as a plain
 * local file (`optionFileProblem`); undefined when there is none. Checked
 * before the run starts, by the toolkit's ffmpeg runners and by every raw
 * ffprobe run (`unguardedProbeLinkRefusal`).
 */
export function optionFileLinkRefusal(args: readonly string[], tool: "ffmpeg" | "ffprobe"): ProbeSourceBlockedError | undefined {
  const found = optionFileProblem(args)
  if (!found) return undefined
  return new ProbeSourceBlockedError(
    "link",
    found.problem === "names a link"
      ? `${tool}: blocked — the file ${found.option} reads names a link; a link may only be read as an input (-i <link>)`
      : `${tool}: blocked — ${found.option} reads its value from something that is not a readable local file, so it cannot be checked for links`,
  )
}

/**
 * The first hop: reject non-http(s), a link two URL parsers would read
 * differently, and a host that is (or resolves to) a private/reserved address.
 * Local filesystem paths (no "://") pass — they never touch the network.
 */
export async function assertSafeProbeSource(src: string): Promise<void> {
  if (!isNetworkProbeSource(src)) return // local filesystem path — no network I/O
  // The host below is read the WHATWG way, but ffprobe is handed the raw
  // string and parses it itself: a link the two would read differently (a
  // backslash, a control character) is refused before either reads it.
  if (hasUrlParserHazard(src)) {
    throw new ProbeSourceBlockedError("link", "probeVideoSource: blocked — a link two URL parsers read differently")
  }
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    throw new ProbeSourceBlockedError("link", `probeVideoSource: blocked — invalid URL "${src}"`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProbeSourceBlockedError("link", `probeVideoSource: blocked non-http(s) protocol ${parsed.protocol}`)
  }
  await checkProbeHost(parsed.hostname)
}

/**
 * ffmpeg's own redirect limit (its default on the pinned 8.1.2), passed
 * explicitly so a future ffmpeg default cannot move it: a public link that
 * redirects up to 8 times reads as it always has.
 */
export const PROBE_MAX_REDIRECTS = 8

/**
 * The transports a guarded probe may open. A network source: http and https
 * (with `tcp`, `tls` and `httpproxy`, which https needs to tunnel through the
 * proxy), never `file` — a playlist on someone's server must not read this
 * server's files. A local path: `file` only — a downloaded file that turns out
 * to be a playlist must not reach the network.
 */
export const REMOTE_PROBE_PROTOCOLS = "http,https,tcp,tls,httpproxy"
export const LOCAL_PROBE_PROTOCOLS = "file"

/**
 * The demuxers a link may be read by: the ones that read a file from the file
 * itself (`SINGLE_FILE_DEMUXERS`). With playlists and manifests out, nothing a
 * remaining demuxer opens names a transport, so `httpproxy` stays on the
 * protocol list only as the tunnel https needs to the proxy. A MOV's external
 * data references stay off: `enable_drefs` is off by default and is pinned off
 * as well (ffprobe takes the option whatever demuxer then reads the file,
 * measured on the pinned 8.1.2).
 */
export const REMOTE_PROBE_FORMATS: readonly string[] = SINGLE_FILE_DEMUXERS

/** The input options a probe of `src` passes ffprobe, before the input. */
export function probeInputArgs(src: string): string[] {
  return isNetworkProbeSource(src)
    ? [
        "-protocol_whitelist", REMOTE_PROBE_PROTOCOLS,
        "-max_redirects", String(PROBE_MAX_REDIRECTS),
        "-format_whitelist", REMOTE_PROBE_FORMATS.join(","),
        "-enable_drefs", "0",
      ]
    : ["-protocol_whitelist", LOCAL_PROBE_PROTOCOLS]
}

/**
 * The options a run that reads a link may not set itself: the guard sets them
 * (ffprobe keeps an option's last value wherever it sits, so a caller's own
 * could widen the guard's), and `-http_proxy` would take the run off the
 * guard's proxy.
 */
export const PROBE_GUARD_OPTIONS: ReadonlySet<string> = new Set(["-protocol_whitelist", "-protocol_blacklist", "-format_whitelist", "-enable_drefs", "-max_redirects", "-http_proxy"])

/** Whether `arg` sets one of {@link PROBE_GUARD_OPTIONS}, also with its value read from a file (`-/protocol_whitelist <file>`). */
export function isProbeGuardOption(arg: string): boolean {
  return PROBE_GUARD_OPTIONS.has(arg.startsWith("-/") ? `-${arg.slice(2)}` : arg)
}

/**
 * The input options an ffmpeg run places right before a link's `-i`
 * (`ffmpeg-reading-links.ts`): a probe's, without `-enable_drefs`. The ffmpeg
 * CLI refuses an input option the demuxer it picks does not have ("Option
 * enable_drefs not found" for a WebM, measured on the pinned 8.1.2); the
 * option is off by default, and a caller cannot turn it on
 * (`PROBE_GUARD_OPTIONS`).
 */
export function ffmpegLinkInputArgs(): string[] {
  return ["-protocol_whitelist", REMOTE_PROBE_PROTOCOLS, "-max_redirects", String(PROBE_MAX_REDIRECTS), "-format_whitelist", REMOTE_PROBE_FORMATS.join(",")]
}

/**
 * The input options for a LOCAL copy of a user's file (the own-storage
 * fallback downloads one): the `file` protocol only, as for any local path,
 * and the same container rule as a link, so a self-host refuses a playlist or
 * a manifest Cloud refuses — and such a file cannot make ffprobe read other
 * files on this server.
 */
export function storedCopyProbeArgs(): string[] {
  return ["-protocol_whitelist", LOCAL_PROBE_PROTOCOLS, "-format_whitelist", REMOTE_PROBE_FORMATS.join(","), "-enable_drefs", "0"]
}

/**
 * What a route answers a link that is not an ordinary media file (a refusal
 * with reason `container`): a 400 the user can act on.
 */
export const NOT_A_MEDIA_FILE = Object.freeze({
  code: "media_link_not_a_file" as const,
  message: "The link must be an ordinary video or audio file, not a streaming playlist. Upload the file instead.",
})

/** ffprobe refusing a demuxer off `-format_whitelist`: `[hls @ 0x…] Format not on whitelist '…'`. */
const FORMAT_NOT_ON_WHITELIST = /\[([\w,]+) @ [^\]]*\] Format not on whitelist/

/** ffprobe's failure read as the typed refusal of a link that is not an ordinary media file, or undefined. */
export function containerRefusalOf(err: unknown): (ProbeSourceBlockedError & { readonly demuxer: string }) | undefined {
  const demuxer = FORMAT_NOT_ON_WHITELIST.exec(err instanceof Error ? err.message : String(err))?.[1]
  if (!demuxer) return undefined
  return Object.assign(new ProbeSourceBlockedError("container", `probeVideoSource: blocked — a ${demuxer} link is not an ordinary media file`), { cause: err, demuxer })
}

/**
 * The ffmpeg CLI logs the same refusal under the input it was opening
 * (`[in#0 @ 0x…] Format not on whitelist '…'`), never the demuxer's name
 * (measured on the pinned 8.1.2).
 */
const INPUT_FORMAT_NOT_ON_WHITELIST = /\[in#\d+ @ [^\]]*\] Format not on whitelist/

/**
 * {@link containerRefusalOf} for an ffmpeg run: read from the run's full
 * stderr when its failure carries one (`runFfmpegCapture`), since the
 * message keeps only a tail. The CLI's form names no demuxer, so the refusal
 * reads as a playlist's ({@link notAMediaFileRefusal}).
 */
export function ffmpegContainerRefusalOf(err: unknown): ProbeSourceBlockedError | undefined {
  const stderr = (err as { stderr?: unknown } | null)?.stderr
  const text = typeof stderr === "string" ? stderr : err instanceof Error ? err.message : String(err)
  const named = containerRefusalOf(new Error(text))
  if (named) return Object.assign(named, { cause: err })
  if (!INPUT_FORMAT_NOT_ON_WHITELIST.test(text)) return undefined
  return Object.assign(new ProbeSourceBlockedError("container", "probeVideoSource: blocked — the link is not an ordinary media file"), { cause: err })
}

/** The demuxers of a playlist, a stream manifest or a concat script: what "not a streaming playlist" is said of. */
const MANIFEST_DEMUXERS: ReadonlySet<string> = new Set(["hls", "dash", "imf", "concat", "webm_dash_manifest"])

/**
 * What a route answers a link in any other format the probe does not read (a
 * GIF, an image, a raw elementary stream, MXF…): the same code, saying which
 * formats it takes.
 */
export const UNSUPPORTED_MEDIA_FORMAT = Object.freeze({
  code: NOT_A_MEDIA_FILE.code,
  message: "The link must be a video or audio file in a supported format (MP4, MOV, WebM, MKV, AVI, MP3, WAV, M4A, AAC, OGG or FLAC).",
})

/**
 * The route refusal for a probe failure that refused a link as not an ordinary
 * media file ({@link NOT_A_MEDIA_FILE}), or undefined for any other failure.
 * Read by its shape, so a test's stand-in error class reads the same.
 */
export function notAMediaFileRefusal(err: unknown): typeof NOT_A_MEDIA_FILE | typeof UNSUPPORTED_MEDIA_FORMAT | undefined {
  const e = err as { reason?: unknown; demuxer?: unknown } | null
  if (e?.reason !== "container") return undefined
  // A playlist (or a refusal that does not say which demuxer) is told to upload the file; any other format, which formats are read.
  const demuxers = typeof e.demuxer === "string" ? e.demuxer.split(",") : []
  return demuxers.length === 0 || demuxers.some((d) => MANIFEST_DEMUXERS.has(d)) ? NOT_A_MEDIA_FILE : UNSUPPORTED_MEDIA_FORMAT
}

/** What a measuring route answers when a link's host could not be looked up just now: retryable (503). */
export const LINK_HOST_UNREACHABLE = Object.freeze({
  code: "source_unreachable" as const,
  message: "Could not reach the link's host just now — run it again.",
})

/** What a measuring route answers when reading the link ran out of time: retryable (503). */
export const LINK_READ_TIMED_OUT = Object.freeze({
  code: "probe_timeout" as const,
  message: "Timed out reading the link — run it again.",
})

/**
 * What a measuring route answers when the server could not run its own read
 * of the link just now: retryable (503). Nothing is wrong with the link.
 */
export const PROBE_UNAVAILABLE = Object.freeze({
  code: "probe_unavailable" as const,
  message: "Could not read the link just now — run it again.",
})

/**
 * What a measuring route answers a link whose host it will not read (a 400:
 * the link has to change): {@link LINK_HOST_NOT_FOUND} for a host that does
 * not exist (reason `host`), {@link LINK_NOT_PUBLIC} for one that is, resolves
 * to, or redirects to a private or reserved address (reason `address`).
 */
export const MEDIA_LINK_BAD_HOST = "media_link_bad_host" as const

/** A link whose host does not exist: its own 400, never "the file may be corrupted". */
export const LINK_HOST_NOT_FOUND = Object.freeze({
  code: MEDIA_LINK_BAD_HOST,
  message: "Could not read the link: its host was not found. Check the link.",
})

/** A link on (or redirecting to) a private or reserved address, which the server never reads: its own 400. */
export const LINK_NOT_PUBLIC = Object.freeze({
  code: MEDIA_LINK_BAD_HOST,
  message: "Could not read the link: it points to a private or reserved address, which the server does not read. Use a link to a public host, or upload the file.",
})

/** The codes {@link probeLinkRefusal} answers. */
export type ProbeLinkRefusalCode = typeof NOT_A_MEDIA_FILE.code | typeof LINK_HOST_UNREACHABLE.code | typeof LINK_READ_TIMED_OUT.code | typeof PROBE_UNAVAILABLE.code | typeof MEDIA_LINK_BAD_HOST

/** `err` and the errors it was caused by, nearest first (a few levels: a guard refusal wraps the run's failure). */
function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  for (let e: unknown = err; e && typeof e === "object" && chain.length < 5; e = (e as { cause?: unknown }).cause) chain.push(e)
  return chain
}

/**
 * A probe the server itself did not get to run to its end: its reader never
 * started (the spawn failed: ENOENT, EAGAIN, EMFILE…, flagged `notStarted` by
 * the runners, or the spawn's own error), or its read, or its wait for a slot,
 * was stopped (an `AbortError`, or a failure flagged `aborted`) without
 * running out of time. Read through the cause chain.
 */
export function probeNotRun(err: unknown): boolean {
  return causeChain(err).some((e) => {
    const f = e as { notStarted?: unknown; aborted?: unknown; name?: unknown; syscall?: unknown }
    return f.notStarted === true || f.aborted === true || f.name === "AbortError" || (typeof f.syscall === "string" && f.syscall.startsWith("spawn"))
  })
}

/**
 * The ONE meaning a probe failure has on every route that measures a link
 * before its charge, when the failure is not about the file's own content:
 * - a link that is not an ordinary media file → 400 {@link NOT_A_MEDIA_FILE};
 * - a host whose lookup failed for now (reason `dns`, at the first hop or any
 *   later one) → 503 {@link LINK_HOST_UNREACHABLE}, `source_unreachable`;
 * - a read that ran out of time → 503 {@link LINK_READ_TIMED_OUT}, `probe_timeout`;
 * - a read the server could not run (its reader failed to start, or it was
 *   stopped) → 503 {@link PROBE_UNAVAILABLE}, `probe_unavailable`;
 * - a host that does not exist (reason `host`) → 400 {@link LINK_HOST_NOT_FOUND},
 *   and a private or reserved address, at the first hop or any later one
 *   (reason `address`) → 400 {@link LINK_NOT_PUBLIC}: both `media_link_bad_host`.
 * Undefined for anything else (a file ffprobe cannot read): the route's own
 * "could not read" refusal (400). Trim, Loop and Combine Videos answer the same
 * codes. MCP passes the 400s on with their message as it does every 400, and
 * the 503s by name. Read by shape, so a test's stand-in error class reads the
 * same.
 */
export function probeLinkRefusal(err: unknown): { readonly code: ProbeLinkRefusalCode; readonly message: string } | undefined {
  const notMedia = notAMediaFileRefusal(err)
  if (notMedia) return notMedia
  const reason = (err as { reason?: unknown } | null)?.reason
  if (reason === "dns") return LINK_HOST_UNREACHABLE
  // Out of time anywhere in the chain (a stop whose cause is a timeout is a timeout).
  if (causeChain(err).some((c) => (c as { timedOut?: unknown }).timedOut === true || (c as { name?: unknown }).name === "TimeoutError")) return LINK_READ_TIMED_OUT
  if (probeNotRun(err)) return PROBE_UNAVAILABLE
  if (reason === "host") return LINK_HOST_NOT_FOUND
  if (reason === "address") return LINK_NOT_PUBLIC
  return undefined
}

/** The retryable codes a measuring route answers (503): run it again. */
export type RetryableProbeRefusalCode = typeof LINK_HOST_UNREACHABLE.code | typeof LINK_READ_TIMED_OUT.code | typeof PROBE_UNAVAILABLE.code
const RETRYABLE_PROBE_REFUSAL_CODES: ReadonlySet<string> = new Set<RetryableProbeRefusalCode>([LINK_HOST_UNREACHABLE.code, LINK_READ_TIMED_OUT.code, PROBE_UNAVAILABLE.code])

/** Whether a measuring route's refusal is a retryable one ({@link probeRefusalStatus} 503). */
export function isRetryableProbeRefusal<T extends { readonly code: string }>(refusal: T): refusal is T & { readonly code: RetryableProbeRefusalCode } {
  return RETRYABLE_PROBE_REFUSAL_CODES.has(refusal.code)
}

/** The HTTP status of a measuring route's refusal code: 503 for a retryable one, 400 for the rest. */
export function probeRefusalStatus(code: string): 400 | 503 {
  return RETRYABLE_PROBE_REFUSAL_CODES.has(code) ? 503 : 400
}

/**
 * The most a file of this install's own storage is downloaded to be probed
 * when the link guard refuses its address (a self-host whose bundled storage
 * sits behind the app's own origin, on a loopback or private address:
 * `readProbeSource`'s fallback). A larger file is refused (the download
 * fails), never read in part.
 */
export const OWN_STORAGE_PROBE_MAX_BYTES = 2 * 1024 ** 3

/** The user name of a run's proxy credential (its password is the run's own random token). */
const PROXY_USER = "probe"
/** How the proxy asks for the credential. */
const PROXY_CHALLENGE = 'Basic realm="probe"'

/** One guarded ffprobe run's proxy. */
export interface ProbeEgress {
  /** The environment the ffprobe child runs with: `http_proxy` at this proxy (with the run's credential), no `no_proxy`. */
  readonly env: NodeJS.ProcessEnv
  /** The first hop this run refused, if any. */
  refusal(): ProbeSourceBlockedError | undefined
  /** Stop the proxy and drop any connection still open. */
  close(): Promise<void>
}

/** Headers that belong to one connection, never forwarded across the proxy. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authorization", "proxy-authenticate", "te", "trailer", "transfer-encoding", "upgrade"])

/** `rawHeaders` without the hop-by-hop ones (and any the `Connection` header names). */
function endToEndHeaders(raw: readonly string[]): string[] {
  const named = new Set<string>(HOP_BY_HOP)
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]!.toLowerCase() === "connection") for (const n of raw[i + 1]!.split(",")) named.add(n.trim().toLowerCase())
  }
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 2) if (!named.has(raw[i]!.toLowerCase())) out.push(raw[i]!, raw[i + 1]!)
  return out
}

/** A `net.connect` lookup that answers with the addresses already checked (never a second resolve). */
function pinnedLookup(addrs: readonly ProbeAddress[]): net.LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, addrs.map((a) => ({ address: a.address, family: a.family })))
    else cb(null, addrs[0]!.address, addrs[0]!.family)
  }) as unknown as net.LookupFunction
}

/** `host:port` of a CONNECT request (`[v6]:port` for IPv6); undefined when it is not one. */
function connectTarget(target: string | undefined): { host: string; port: number } | undefined {
  const m = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/.exec(target ?? "")
  const port = m ? Number(m[2]) : Number.NaN
  return m && port > 0 && port < 65536 ? { host: m[1]!, port } : undefined
}

/** The environments the guard's runs hand ffprobe: a raw runner checks a link's run carries one (`isProbeGuardEnv`). */
const guardEnvs = new WeakSet<NodeJS.ProcessEnv>()

/** Whether `env` is a guarded run's (`openProbeEgress`): the only environment an ffprobe given a link may run with. */
export function isProbeGuardEnv(env: NodeJS.ProcessEnv | undefined): boolean {
  return env !== undefined && guardEnvs.has(env)
}

/**
 * FAIL CLOSED: a raw ffprobe run is never handed a link. A run whose arguments
 * name one (`namesALink`: "://" as written, or in filter escaping) must carry a
 * guarded run's environment (`readProbeSource` gives it); otherwise this is the
 * error it is refused with, before ffprobe starts. A link in a file an option
 * reads its value from (`-/i <file>`) is refused in every run, guarded or not
 * (`optionFileLinkRefusal`). Every place that starts ffprobe itself checks its
 * arguments with it (the probe guard census holds that).
 */
export function unguardedProbeLinkRefusal(args: readonly string[], env: NodeJS.ProcessEnv | undefined): Error | undefined {
  const fromFile = optionFileLinkRefusal(args, "ffprobe")
  if (fromFile) return fromFile
  if (isProbeGuardEnv(env) || !args.some((a) => namesALink(a))) return undefined
  return new Error("ffprobe was handed a link outside the probe guard: read a link with readProbeSource or a guarded probe")
}

/** The environment an ffprobe child runs with through `proxyUrl`. */
function egressEnv(proxyUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, http_proxy: proxyUrl }
  // ffmpeg skips the proxy for any host `no_proxy` names (measured on the pinned 8.1.2).
  delete env.no_proxy
  delete env.NO_PROXY
  guardEnvs.add(env)
  return env
}

/**
 * Start the proxy one guarded ffprobe run reads through (see the module note).
 * Every request is checked by `checkProbeHost` before any connection is
 * opened; the first refusal is kept for `refusal()`. Close it when the run ends.
 */
export async function openProbeEgress(): Promise<ProbeEgress> {
  let refused: ProbeSourceBlockedError | undefined
  let closed = false
  const sockets = new Set<net.Socket>()
  const track = (s: net.Socket) => {
    if (closed) return void s.destroy()
    sockets.add(s)
    // A reset from either side only ends that connection: never an unhandled error in the server.
    s.on("error", () => s.destroy())
    s.once("close", () => sockets.delete(s))
  }

  /** The addresses `host` may be reached at, or undefined (the refusal recorded) when it may not. */
  const admit = async (host: string): Promise<readonly ProbeAddress[] | undefined> => {
    try {
      return await checkProbeHost(host)
    } catch (err) {
      const blocked = err instanceof ProbeSourceBlockedError ? err : new ProbeSourceBlockedError("dns", `probeVideoSource: blocked — DNS resolution failed for ${host}`)
      refused ??= blocked
      return undefined
    }
  }
  const refusalStatus = () => (refused?.reason === "address" ? 403 : 502)

  // FAIL CLOSED AND LOCAL: whatever an origin answers, or however a socket
  // fails, only that one connection ends — ffprobe then sees a broken read and
  // the probe fails as unreadable. Nothing may reach the process's
  // uncaught-exception or unhandled-rejection handler (the API and the workers
  // exit there). So every listener body runs inside `contained`, each async
  // handler's promise is caught, and every stream has an error listener.

  /** End this client exchange for good, whatever state it is in. */
  const drop = (res: http.ServerResponse) => {
    try {
      res.destroy()
    } catch {
      res.socket?.destroy()
    }
  }
  /** `fn` as a listener whose throw ends only `onThrow`'s connection. */
  const contained = <A extends unknown[]>(fn: (...args: A) => void, onThrow: () => void) => (...args: A): void => {
    try {
      fn(...args)
    } catch {
      onThrow()
    }
  }
  /** Answer `status` and close, or drop the connection when even that fails. */
  const answer = (res: http.ServerResponse, status: number) => {
    try {
      res.writeHead(status, { connection: "close" }).end()
    } catch {
      drop(res)
    }
  }

  // A credential of this run's own: ffmpeg sends it (Basic) once the proxy asks
  // for it with a 407 — it never sends one unasked (measured on the pinned
  // 8.1.2) — so another process on the host cannot use this run's proxy, or
  // put a refusal on its record.
  const token = randomBytes(24).toString("base64url")
  const expected = Buffer.from(`Basic ${Buffer.from(`${PROXY_USER}:${token}`).toString("base64")}`)
  const authorized = (req: http.IncomingMessage): boolean => {
    const sent = Buffer.from(String(req.headers["proxy-authorization"] ?? ""))
    return sent.length === expected.length && timingSafeEqual(sent, expected)
  }
  const answerChallenge = (res: http.ServerResponse) => {
    try {
      res.writeHead(407, { "proxy-authenticate": PROXY_CHALLENGE, "content-length": "0", connection: "close" }).end()
    } catch {
      drop(res)
    }
  }

  const server = http.createServer()
  server.on("connection", track)
  server.on("clientError", (_err, socket) => socket.destroy())

  // An http hop: ffmpeg sends the absolute URL; forward it to the checked address as an origin request.
  const forward = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    req.on("error", () => drop(res))
    res.on("error", () => drop(res))
    let target: URL
    try {
      target = new URL(req.url ?? "")
    } catch {
      refused ??= new ProbeSourceBlockedError("link", `probeVideoSource: blocked — invalid URL "${String(req.url ?? "").slice(0, 120)}"`)
      return answer(res, 400)
    }
    if (target.protocol !== "http:") {
      refused ??= new ProbeSourceBlockedError("link", `probeVideoSource: blocked non-http(s) protocol ${target.protocol}`)
      return answer(res, 400)
    }
    const addrs = await admit(target.hostname)
    if (!addrs) return answer(res, refusalStatus())
    // The run ended (or its ffprobe went away) while the host was looked up: open nothing.
    if (closed || req.destroyed) return drop(res)
    // Strict parsing (Node's default) in both directions of a plain-http hop:
    // ffmpeg's own requests always conform, and a reply that breaks HTTP/1.1
    // syntax (obs-fold, both Content-Length and Transfer-Encoding, a bare LF)
    // is a parse error on this request — its `error` below — before any of its
    // values reach `writeHead`, so such an origin is unreadable (fail closed).
    // https is a byte tunnel and is never parsed.
    const upstream = http.request({
      host: target.hostname.replace(/^\[|\]$/g, ""),
      port: Number(target.port || 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: endToEndHeaders(req.rawHeaders),
      setHost: false,
      agent: false,
      lookup: pinnedLookup(addrs),
    })
    const fail = () => {
      upstream.destroy()
      drop(res)
    }
    upstream.on("socket", contained(track, fail))
    // An origin that cannot be reached, or whose reply does not parse, is a transport failure for ffprobe.
    upstream.on("error", () => drop(res))
    upstream.on("response", contained((ures: http.IncomingMessage) => {
      ures.on("error", fail)
      // A body cut off before its end (a reset) must not leave ffprobe waiting on the rest.
      ures.on("close", () => {
        if (!ures.complete) fail()
      })
      // Throws for a reply that parsed but cannot be passed on (a status under 100, a value
      // writeHead refuses): `contained` ends this connection only.
      res.writeHead(ures.statusCode ?? 502, ures.statusMessage, endToEndHeaders(ures.rawHeaders))
      ures.pipe(res)
    }, fail))
    // A request that ends with neither a response nor an error (a protocol switch, which this proxy never
    // takes) must not leave ffprobe waiting for one until its watchdog.
    upstream.on("close", () => {
      if (!res.headersSent) drop(res)
    })
    res.on("close", () => upstream.destroy())
    req.pipe(upstream)
  }
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Only this run's ffprobe: anyone else is asked for the credential, and nothing is looked up or recorded.
    if (!authorized(req)) return answerChallenge(res)
    forward(req, res).catch(() => drop(res))
  })

  // An https hop: a CONNECT tunnel to the checked address, passed through byte for byte.
  const tunnel = async (req: http.IncomingMessage, client: net.Socket, head: Buffer): Promise<void> => {
    const target = connectTarget(req.url)
    if (!target) {
      refused ??= new ProbeSourceBlockedError("link", "probeVideoSource: blocked — a tunnel to no valid host")
      return void client.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }
    const addrs = await admit(target.host)
    if (!addrs) return void client.end(`HTTP/1.1 ${refusalStatus()} Refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
    if (closed || client.destroyed) return void client.destroy()
    const upstream = net.connect({ host: target.host.replace(/^\[|\]$/g, ""), port: target.port, lookup: pinnedLookup(addrs) })
    track(upstream)
    const fail = () => {
      upstream.destroy()
      client.destroy()
    }
    upstream.once("connect", contained(() => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    }, fail))
    // The origin's end reaches the client through the pipe (its writes flushed); only a reset tears it down.
    upstream.on("error", () => client.destroy())
    client.on("close", () => upstream.destroy())
  }
  server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    client.on("error", () => client.destroy())
    if (!authorized(req)) return void client.end(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: ${PROXY_CHALLENGE}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
    tunnel(req, client, head).catch(() => client.destroy())
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  // Listening: a later server-level error ends the run's reads, never the process.
  server.removeAllListeners("error")
  server.on("error", () => undefined)
  const { port } = server.address() as net.AddressInfo
  return {
    env: egressEnv(`http://${PROXY_USER}:${token}@127.0.0.1:${port}`),
    refusal: () => refused,
    close: () =>
      new Promise<void>((resolve) => {
        closed = true
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}

/**
 * A failure that says what happened by itself, whatever the proxy refused on
 * the way: the read ran out of time or was stopped (ffprobe killed at its
 * timeout, its caller's signal), or the probe refused the link itself (a
 * `ProbeSourceBlockedError`, e.g. not an ordinary media file).
 */
function failedOnItsOwn(err: unknown): boolean {
  const e = err as { timedOut?: unknown; aborted?: unknown; name?: unknown } | null
  if (e?.timedOut === true || e?.aborted === true || e?.name === "TimeoutError" || e?.name === "AbortError") return true
  return err instanceof ProbeSourceBlockedError
}

/**
 * Run `read` with a fresh proxy (`openProbeEgress`), closed when it ends. When
 * `read` fails after the proxy refused a hop, and for no other reason it can
 * name, the refusal is what is thrown (the failure as its cause): the same
 * `ProbeSourceBlockedError` the first hop gets. A failure that names its own
 * cause — a timeout, a stop, the probe's own refusal — is thrown as it is, so a
 * read that timed out after a refused hop (a playlist alternate skipped) is
 * still a timeout. A run that succeeds read only what the proxy let through.
 */
export async function withProbeEgress<T>(read: (egress: ProbeEgress) => Promise<T>): Promise<T> {
  const egress = await openProbeEgress()
  try {
    return await read(egress)
  } catch (err) {
    const refusal = egress.refusal()
    if (refusal && !failedOnItsOwn(err)) throw Object.assign(new ProbeSourceBlockedError(refusal.reason, refusal.message), { cause: err })
    throw err
  } finally {
    await egress.close()
  }
}
