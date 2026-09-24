import Fastify from "fastify"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { constantTimeEqualStr } from "../constant-time.js"
import { daemonListProblem } from "../private-plugins/daemons.js"
import type { PluginDaemon, PluginDaemonHealth } from "../private-plugins/daemon-contract.js"

/**
 * Hosts private-plugin daemons (`PluginDaemon`): starts each one, owns the
 * internal listener their routes live on, and stops them within a bounded
 * drain. Content-free — it knows nothing about what a daemon connects to.
 *
 * The listener's door is this module's, never a daemon's: every route except
 * `GET /health` requires `X-Internal-Orchestrator-Secret` (the same header and
 * the same constant-time comparison as the API's auth hook), checked in an
 * `onRequest` hook that runs before routing — so an unknown path is a 401 to a
 * stranger rather than a route oracle, and a daemon can neither forget nor
 * weaken the check.
 */

/** How long `stop()` waits, in all, for the daemons to settle after the abort. */
export const DEFAULT_DRAIN_MS = 8_000
const SECRET_HEADER = "x-internal-orchestrator-secret"
/** The floor config.ts sets for INTERNAL_ORCHESTRATOR_SECRET, re-checked here: an empty secret would admit an empty header. */
const MIN_SECRET_LENGTH = 32

export interface PluginDaemonHostOptions {
  daemons: readonly PluginDaemon[]
  port: number
  host: string
  /** The internal secret every non-health request must carry (≥ 32 characters). */
  secret: string
  /** How long `stop()` waits for daemons to settle after the abort. */
  drainMs?: number
  /**
   * A daemon stopped on its own: `start()` rejected, or resolved while its
   * signal was still live. Called at most once per daemon; the entry point
   * exits non-zero so the platform restarts the process.
   */
  onCrash(name: string, err: unknown): void
}

export interface PluginDaemonHost {
  /** The bound port (a caller may ask for port 0). */
  port: number
  /** Aborts every daemon, waits at most `drainMs`, closes the listener. Idempotent. */
  stop(): Promise<void>
}

function isOpenHealthProbe(req: FastifyRequest): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  return req.url.split("?", 1)[0] === "/health"
}

const DETAIL_KEY = /^[A-Za-z0-9_]{1,40}$/
const MAX_DETAIL_ENTRIES = 20

/**
 * `/health` answers without the secret, so what a daemon reports is filtered
 * here rather than trusted: counters and flags under plain keys, nothing else
 * (no handle, no error text, no nested object).
 */
function countersOnly(detail: unknown): Record<string, number | boolean> | undefined {
  if (!detail || typeof detail !== "object") return undefined
  const kept = Object.entries(detail)
    .filter(
      ([key, value]) =>
        DETAIL_KEY.test(key) && (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))),
    )
    .slice(0, MAX_DETAIL_ENTRIES)
  return kept.length > 0 ? (Object.fromEntries(kept) as Record<string, number | boolean>) : undefined
}

function daemonHealth(daemon: PluginDaemon): PluginDaemonHealth {
  if (!daemon.health) return { ok: true }
  try {
    const reported = daemon.health()
    const detail = countersOnly(reported.detail)
    return detail ? { ok: reported.ok === true, detail } : { ok: reported.ok === true }
  } catch {
    return { ok: false }
  }
}

/**
 * Removes the secret from the request once it has been checked, so no daemon
 * handler can log or forward it (on the API it authenticates as any user).
 * `rawHeaders` carries a second copy; both are scrubbed in place — there is no
 * immutable way to take a header off a live request.
 */
function scrubSecret(req: FastifyRequest): void {
  delete req.headers[SECRET_HEADER]
  const raw = req.raw.rawHeaders
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i].toLowerCase() === SECRET_HEADER) raw[i + 1] = ""
  }
}

/** The door: anything but the open health probe must carry the internal secret. */
function requireInternalSecret(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (isOpenHealthProbe(req)) return
    const provided = req.headers[SECRET_HEADER]
    if (typeof provided !== "string" || !constantTimeEqualStr(provided, secret)) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Internal secret required" } })
    }
    scrubSecret(req)
  }
}

/** `GET /health`: 200 while every daemon reports ok, 503 otherwise. */
function healthHandler(daemons: readonly PluginDaemon[]) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    const report = Object.fromEntries(daemons.map((d) => [d.name, daemonHealth(d)]))
    const ok = Object.values(report).every((h) => h.ok)
    return reply.code(ok ? 200 : 503).send({ ok, daemons: report })
  }
}

/** The listener with its door, `/health`, and every daemon's routes under `/<name>` — not yet listening. */
async function buildInternalListener(daemons: readonly PluginDaemon[], secret: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("onRequest", requireInternalSecret(secret))
  app.get("/health", healthHandler(daemons))
  for (const daemon of daemons) {
    const register = daemon.registerInternalRoutes
    if (register) await app.register(async (scope) => register(scope), { prefix: `/${daemon.name}` })
  }
  return app
}

/** Starts every daemon; one that stops while `signal` is still live is reported as a crash. */
function startDaemons(
  daemons: readonly PluginDaemon[],
  signal: AbortSignal,
  onCrash: PluginDaemonHostOptions["onCrash"],
): Promise<void>[] {
  const crashed = (name: string, err: unknown) => {
    if (!signal.aborted) onCrash(name, err)
  }
  return daemons.map((daemon) =>
    Promise.resolve()
      .then(() => daemon.start({ signal }))
      .then(
        () => crashed(daemon.name, new Error("daemon stopped on its own")),
        (err: unknown) => crashed(daemon.name, err),
      ),
  )
}

/** Resolves once every promise settled or `ms` elapsed, whichever comes first. */
async function settleWithin(promises: readonly Promise<unknown>[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([Promise.allSettled(promises), deadline])
  } finally {
    clearTimeout(timer)
  }
}

function boundPort(app: FastifyInstance, requested: number): number {
  const address = app.server.address()
  return typeof address === "object" && address ? address.port : requested
}

/**
 * Validates the daemon list and the secret, opens the internal listener, then
 * starts every daemon. Throws before listening on a malformed list or a short
 * secret, and when the port cannot be bound.
 */
export async function startPluginDaemonHost(opts: PluginDaemonHostOptions): Promise<PluginDaemonHost> {
  const problem = daemonListProblem(opts.daemons)
  if (problem) throw new Error(`[plugin-daemons] cannot host: ${problem}`)
  if (opts.secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`[plugin-daemons] the internal secret must be at least ${MIN_SECRET_LENGTH} characters`)
  }

  const app = await buildInternalListener(opts.daemons, opts.secret)
  await app.listen({ port: opts.port, host: opts.host })

  const controller = new AbortController()
  const running = startDaemons(opts.daemons, controller.signal, opts.onCrash)
  const drainMs = opts.drainMs ?? DEFAULT_DRAIN_MS
  let stopping: Promise<void> | null = null

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      controller.abort()
      await settleWithin(running, drainMs)
      await app.close()
    })()
    return stopping
  }

  return { port: boundPort(app, opts.port), stop }
}
