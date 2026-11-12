// backend/src/lib/concurrency-lanes/request-scope.ts — every route handler runs
// inside a request scope, so the funnels deep inside it (the provider egress,
// the LLM router, the Replicate and fal SDK clients) know whose request it is,
// how long it may wait for a slot, and when its client went away.
//
// installLaneRequestScope adds an `onRoute` hook that wraps every handler. The
// scope is a hold scope (hold.ts) whose hold is `request` until the request
// takes a slot — at `laneGuard` (a preHandler, before the handler reserves
// credits), at `acquireLiveLane` (a stream handler), or at the first funnel
// call — and the leaf hold of that slot after it, so every later call in the
// request runs under it.
//
// Requests made in-process (`fastify.inject`: the plugin toolkit's
// `http.workerRequest`, the video director's `injectJob`, the MCP tools
// through internal-request.ts) run inside their caller's async context and
// inherit what it holds:
//   - under a leaf or not-limited hold the handler runs under it: nothing
//     in the route takes a slot;
//   - under a run or coordinator hold the route's slot is taken at the FRONT
//     of the job's line and waits under the queue timeout, never the live
//     limit; the time waited counts as the job's in-handler wait;
//   - inside another request that holds no slot yet, the route waits like it,
//     on its transport and its client's abort signal (an MCP tool's route waits
//     at most the `mcp` ceiling);
//   - with none of these (a job-originated inject of a scope that ended, a
//     cron), the request is its own outermost request.
//
// A live wait lasts at most min(live-wait limit, the transport's ceiling):
// `sse` (Accept: text/event-stream), `mcp` (the /mcp route) or `json`. Past
// it the request is answered 503 `lane_busy` with Retry-After: 60, by the
// wrapper (or laneGuard) itself, so a route's own error handler never turns it
// into a 500.
//
// Release (one rule): the request owns every slot it takes, and it is released
// once BOTH the handler is no longer running AND the response is over (the raw
// response's `close`, which always comes — after the last byte, or when the
// client leaves) — exactly once, with the outcome of the reply status (failed
// when the response never finished). So a handler that awaits its stream holds
// the slot until the stream ends, a returned stream until it is sent, a
// handler that never ran (a later preHandler answered) or one that answers
// through `reply` after returning until its response is over. A client that
// leaves never releases a slot whose handler is still running — a handler
// still in an LLM call keeps its slot until the call ends — and ends only a
// wait still in progress: never a call the gate grants at once, so with
// enforcement off nothing is ever refused for it. Its signal is the RESPONSE's
// close before the response finished: on current Node the request stream
// closes as soon as its body has been read, so it says nothing about the client.
//
// A workflow's sync-HTTP hop holds its node's slot in the orchestrator and
// names it in LANE_LEASE_HEADER. laneGuard honours it only on an internal
// request (the orchestrator secret), and only when the gate still holds that
// lease, live, on the request's own line (same user, same payer, the guard's
// lane): the handler then runs under it as a leaf and the request takes no
// slot of its own. The request never renews or releases it — its holder does.
// Anything else (a client's header, another user's or an expired lease, the
// gate not answering) is ignored, and the request takes its slot as any other.
// LANE_PARENT_HEADER is read only by lane-parent.ts, on internal requests.
//
// With enforcement off every slot is granted at once (one over the limit is
// recorded as would-have-waited): nothing here delays or refuses a request.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler, RouteOptions } from "fastify"
import { LANE_BUSY_MESSAGE, LaneBusyError, LaneWaitAbortedError, LaneWaitTimeoutError } from "./errors.js"
import type { ConcurrencyGate, ReleaseOutcome } from "./gate.js"
import { countUngated, currentHoldScope, loadConcurrencyGate, newHoldScope, runInHoldScope, warnLaneRateLimited, type ConcurrencyHold, type HoldScope, type RequestSlotState } from "./hold.js"
import type { LeafLane } from "./leaf-lanes.js"
import { lineOfBillingContext } from "./payer.js"
import { lanesMeasureOnly, releaseRequestSlot, takeRequestSlot } from "./slot.js"
import type { PayerKey, WaitInfo } from "./types.js"

export { LANE_PARENT_HEADER } from "./lane-parent.js"

/** The header a workflow's sync-HTTP hop names the slot it already holds in (honoured by laneGuard on internal requests only). */
export const LANE_LEASE_HEADER = "x-nodaro-lane-lease"

/** How long a live client is asked to wait before trying again. */
const RETRY_AFTER_S = 60

type Transport = "json" | "sse" | "mcp"

/** One request's scope, whether its handler is running, and whether its response is over. */
interface RequestLife {
  /** Null: the request runs under its caller's slot (a leaf or not-limited hold) and takes none. */
  scope: HoldScope | null
  running: boolean
  /** The raw response has closed (finished, or the client left). */
  closed: boolean
  /** Created on first read of the request's client signal. */
  gone: AbortController | null
}

const lives = new WeakMap<FastifyRequest, RequestLife>()

/**
 * Requests of an app that installed the request scope. A request of any other
 * app (one built without installLaneRequestScope) takes no slot at all: with
 * no wrapper and no response hook to release one, a slot it took would be
 * renewed for the life of the process.
 */
const scoped = new WeakSet<FastifyRequest>()

declare module "fastify" {
  interface FastifyContextConfig {
    /** This route is an MCP endpoint (routes/mcp.ts): its live waits, and those
     *  of the routes its tools inject, are bounded by the `mcp` ceiling. Set on
     *  every MCP endpoint, wherever it is served (`/mcp`, or a deployment's
     *  path — MCP by path). */
    mcpTransport?: true
  }
}

/** The transport whose ceiling bounds a live wait. */
function transportOf(req: FastifyRequest): Transport {
  if (req.routeOptions?.config?.mcpTransport === true || req.routeOptions?.url === "/mcp") return "mcp"
  const accept = req.headers.accept
  const text = Array.isArray(accept) ? accept.join(",") : (accept ?? "")
  return text.includes("text/event-stream") ? "sse" : "json"
}

/** The line a request's own calls count in (worker-admit.ts reads a job's the same way). */
function lineOfRequest(req: FastifyRequest): { userId: string; payer: PayerKey; tier: string | null } {
  return lineOfBillingContext(req.userId ?? "", req.billingContext)
}

/**
 * The signal that the client went away before the response finished, made on
 * first read (most requests never wait). Already aborted when it did.
 */
function clientGoneSignal(life: RequestLife, reply: FastifyReply): AbortSignal {
  if (!life.gone) {
    life.gone = new AbortController()
    if (life.closed && !reply.raw.writableFinished) life.gone.abort()
  }
  return life.gone.signal
}

const isOpen = (scope: HoldScope | undefined): scope is HoldScope => !!scope && !scope.closed

/** Build the scope of `req`, in the async context it runs in (its caller's, for an injected request). */
function createScope(req: FastifyRequest, reply: FastifyReply, life: RequestLife): HoldScope | null {
  const outer = currentHoldScope()
  const open = isOpen(outer) ? outer : undefined
  const role = open?.hold.role
  if (open && (role === "leaf" || role === "not-limited")) return null

  // Under a job's run or coordinator hold — directly, or through another
  // request that one made: the job's line, the queue timeout, no client.
  const parent = open && role === "request" ? open.request : undefined
  const coordinator = open && (role === "run" || role === "coordinator") ? open.hold : parent?.coordinator
  if (coordinator) {
    const state: RequestSlotState = { transport: undefined, signal: undefined, coordinator, lease: null, pending: null, ended: false }
    const { transport: _none, ...line } = coordinator
    return newHoldScope({ ...line, role: "request", lane: null, leaseId: null }, state)
  }

  // Outermost, or inside another request that holds no slot yet (it then waits as that one waits).
  const transport = parent?.transport ?? transportOf(req)
  const state: RequestSlotState = {
    transport,
    get signal() { return parent ? parent.signal : clientGoneSignal(life, reply) },
    coordinator: undefined,
    lease: null,
    pending: null,
    ended: false,
  }
  const line = lineOfRequest(req)
  const hold: ConcurrencyHold = { role: "request", lane: null, ...line, jobId: null, leaseId: null, transport }
  return newHoldScope(hold, state)
}

/** The life of `req`, created on first use (laneGuard or the wrapper, whichever comes first). */
function lifeOf(req: FastifyRequest, reply: FastifyReply): RequestLife {
  let life = lives.get(req)
  if (!life) {
    const created: RequestLife = { scope: null, running: false, closed: false, gone: null }
    life = created
    lives.set(req, created)
    if (scoped.has(req)) {
      created.scope = createScope(req, reply, created)
      reply.raw.once("close", () => {
        created.closed = true
        const finished = reply.raw.writableFinished
        if (!finished) created.gone?.abort()
        if (!created.running) endScope(created, finished ? outcomeOf(reply) : "failed")
      })
    }
  }
  return life
}

/** The handler is no longer running: release now if the response is over, else when it is (its `close`). */
function handlerDone(life: RequestLife, reply: FastifyReply, outcome: ReleaseOutcome): void {
  life.running = false
  if (life.closed || reply.raw.writableFinished) endScope(life, outcome)
}

/** What a request that settled released its slot as: its status says. */
function outcomeOf(reply: FastifyReply): ReleaseOutcome {
  return reply.statusCode >= 400 ? "failed" : "completed"
}

/** End the request's scope and release its slot. Never throws; a second call changes nothing. */
function endScope(life: RequestLife, outcome: ReleaseOutcome): void {
  life.running = false
  if (life.scope) void releaseRequestSlot(life.scope, outcome, { end: true })
}

/** A wait that ended without a slot, as the error a request answers with; null for any other error. */
function laneAnswer(err: unknown): { status: number; code: string; message: string; retryAfter: boolean } | null {
  if (err instanceof LaneBusyError) return { status: 503, code: err.code, message: err.message, retryAfter: true }
  if (err instanceof LaneWaitTimeoutError) return { status: 503, code: "lane_busy", message: err.message || LANE_BUSY_MESSAGE, retryAfter: true }
  // The client went away while it waited: nobody reads this answer.
  if (err instanceof LaneWaitAbortedError) return { status: 499, code: "client_closed_request", message: err.message, retryAfter: false }
  return null
}

/** Answer a wait that ended without a slot; false when `err` is not one, or the response has already started. */
function sendLaneAnswer(reply: FastifyReply, err: unknown): boolean {
  const answer = laneAnswer(err)
  if (!answer || reply.sent || reply.raw.headersSent) return false
  if (answer.retryAfter) reply.header("Retry-After", String(RETRY_AFTER_S))
  void reply.code(answer.status).send({ error: { code: answer.code, message: answer.message } })
  return true
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v !== null && (typeof v === "object" || typeof v === "function") && typeof (v as { then?: unknown }).then === "function"

const WRAPPED = Symbol("lane-request-scope")
type Handler = RouteOptions["handler"] & { [WRAPPED]?: true }

function wrapHandler(handler: Handler): Handler {
  if (handler[WRAPPED]) return handler
  const wrapped = function laneRequestScope(this: FastifyInstance, req: FastifyRequest, reply: FastifyReply): unknown {
    const life = lifeOf(req, reply)
    const scope = life.scope
    if (!scope) return handler.call(this, req, reply)
    life.running = true
    let result: unknown
    try {
      result = runInHoldScope(scope, () => handler.call(this, req, reply))
    } catch (err) {
      endScope(life, "failed")
      throw err
    }
    if (!isThenable(result)) {
      // A handler that answers through `reply` later: the response's end releases.
      handlerDone(life, reply, outcomeOf(reply))
      return result
    }
    return Promise.resolve(result).then(
      (value) => {
        // A returned value or stream is sent after this: the response's end releases.
        handlerDone(life, reply, outcomeOf(reply))
        return value
      },
      (err: unknown) => {
        endScope(life, "failed")
        if (sendLaneAnswer(reply, err)) return reply
        throw err
      },
    )
  } as Handler
  wrapped[WRAPPED] = true
  return wrapped
}

// ------------------------------------------------------------- route lanes

const LANE_OF_GUARD = Symbol("lane-guard-lane")
const RULE_OF_GUARD = Symbol("lane-guard-rule")
type GuardFn = preHandlerAsyncHookHandler & { [LANE_OF_GUARD]?: LeafLane; [RULE_OF_GUARD]?: string }

/** Route url → the lane its laneGuard takes, filled as routes register. */
const laneByUrl = new Map<string, LeafLane>()
/** Route url → the shared rule (sync-route-lanes.ts) its laneGuard was built from, when it was. */
const ruleByUrl = new Map<string, string>()

function guardOf(preHandler: RouteOptions["preHandler"]): GuardFn | null {
  const list = Array.isArray(preHandler) ? preHandler : preHandler ? [preHandler] : []
  for (const fn of list) {
    if ((fn as GuardFn)[LANE_OF_GUARD]) return fn as GuardFn
  }
  return null
}

/** The lane the route at `url` (its registered path) takes in its laneGuard; null for a route without one. */
export function laneOfRoute(url: string): LeafLane | null {
  return laneByUrl.get(url) ?? null
}

/** The shared rule the route at `url` built its laneGuard from (its key); null for a route with none, or a guard of its own. */
export function laneRuleOfRoute(url: string): string | null {
  return ruleByUrl.get(url) ?? null
}

/** `ask()`, or `fallback` when it throws (a route's reading of a raw, unvalidated body). */
function askOrDefault<T>(ask: () => T, fallback: T): T {
  try {
    return ask()
  } catch {
    return fallback
  }
}

// ------------------------------------------------------------------ public

/**
 * Wrap every route handler registered after this call in a request scope (see
 * the module comment). Call it before any route registers: an `onRoute` hook
 * sees only the routes added after it.
 */
export function installLaneRequestScope(app: FastifyInstance): void {
  app.addHook("onRequest", (req, _reply, done) => {
    scoped.add(req)
    done()
  })
  app.addHook("onRoute", (route) => {
    route.handler = wrapHandler(route.handler as Handler)
    const guard = guardOf(route.preHandler)
    if (guard) {
      laneByUrl.set(route.url, guard[LANE_OF_GUARD]!)
      const rule = guard[RULE_OF_GUARD]
      if (rule) ruleByUrl.set(route.url, rule)
    }
  })
  // The response's `close` releases (lifeOf); this is the same release at its
  // `finish`, for a response that never emits `close`. Idempotent.
  app.addHook("onResponse", (req, reply, done) => {
    const life = lives.get(req)
    if (life && !life.running) endScope(life, outcomeOf(reply))
    done()
  })
}

/** What a laneGuard's `provider` and `when` read: the raw (unvalidated) body and the headers. */
export type LaneRequestView = Pick<FastifyRequest, "body" | "headers">

/** A laneGuard's per-request questions (see laneGuard). `rule` names the shared rule it was built from (sync-route-lanes.ts). */
export interface LaneGuardOpts<R extends LaneRequestView = FastifyRequest> {
  provider?: (req: R) => string | null
  when?: (req: R) => boolean
  rule?: string
}

/**
 * What a laneGuard decides for a request: null when its `when` says the
 * request does none of the lane's work (it takes nothing), else the provider
 * its slot counts against. A `when` that throws counts as true, a `provider`
 * that throws as no provider. The ONE decision — the orchestrator asks it of
 * the body it is about to send (sync-route-lanes.ts), so a node is
 * pre-acquired exactly when its route's guard would take a slot.
 */
export function laneGuardDecision<R extends LaneRequestView>(opts: LaneGuardOpts<R>, req: R): { provider: string | null } | null {
  if (opts.when && !askOrDefault(() => opts.when!(req), true)) return null
  return { provider: askOrDefault(() => opts.provider?.(req) ?? null, null) }
}

/** The lease id an internal request names in LANE_LEASE_HEADER; null for any other request or a malformed value. */
function claimedLeaseOf(req: FastifyRequest): string | null {
  if (req.authKind !== "internal") return null
  const raw = req.headers[LANE_LEASE_HEADER]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value && value.length <= 128 ? value : null
}

/**
 * Run the request under the slot its internal caller already holds, when the
 * request names one (LANE_LEASE_HEADER) and the gate holds it live on the
 * request's own line — the same user, the same payer — for `lane`. The scope
 * then holds it as a leaf: no slot is taken, and since the scope never owns
 * it (`state.lease` stays null), nothing here renews or releases it. False
 * for anything else, the gate not answering included (the header is then
 * ignored and the request takes its slot as any other). Never throws.
 *
 * While limits are locked (lanesMeasureOnly) the gate is not asked: the slot
 * is adopted on the header alone, which only internal auth can send. Nothing
 * is enforced then, and the caller's take may not even have landed yet (it is
 * fired, never awaited) — asking would both delay the request and find no
 * lease, and the request would count a second slot for one piece of work.
 */
async function adoptHeldLease(req: FastifyRequest, scope: HoldScope, lane: LeafLane): Promise<boolean> {
  const leaseId = claimedLeaseOf(req)
  const state = scope.request
  if (!leaseId || !state || state.ended || state.coordinator || scope.hold.role !== "request" || !scope.hold.userId) return false
  if (lanesMeasureOnly()) {
    if (state.lease || state.pending) return false
    scope.hold = { ...scope.hold, role: "leaf", lane, leaseId }
    return true
  }
  let line: Awaited<ReturnType<ConcurrencyGate["leaseLine"]>>
  try {
    line = await (await loadConcurrencyGate()).leaseLine(leaseId)
  } catch (err) {
    warnLaneRateLimited("could not check a held lease, taking the request's own slot", err)
    return false
  }
  const hold = scope.hold
  if (!line || line.userId !== hold.userId || line.payer !== hold.payer || line.lane !== lane) return false
  // Re-checked after the await: nothing may have taken or ended the scope meanwhile.
  if (state.ended || scope.hold.role !== "request" || state.lease || state.pending) return false
  scope.hold = { ...hold, role: "leaf", lane, leaseId }
  return true
}

/**
 * A preHandler that takes the request's slot of `lane` before the handler
 * runs — so a request that cannot get one never reaches the handler's credit
 * reservation. Put it LAST in the route's preHandlers. A live wait past its
 * limit answers 503 `lane_busy`; a client that leaves while it waits gets no
 * handler at all. The slot is held until the handler settles and the response is over.
 *
 * `provider` names the provider the request's work counts against (its
 * ceiling); `when` says whether this request does the lane's work at all — a
 * request it answers false for takes nothing here (a call it makes after all
 * still takes its slot at the funnel). Both read the raw body, before any
 * validation (laneGuardDecision). The route keeps its lane either way
 * (`laneOfRoute`).
 *
 * An internal request that names a slot its caller holds (LANE_LEASE_HEADER —
 * a workflow's sync-HTTP hop) runs under that slot when the gate bears it out
 * — or, while limits are locked, on the header alone — (adoptHeldLease), and
 * takes none.
 */
export function laneGuard(lane: LeafLane, opts: LaneGuardOpts = {}): preHandlerAsyncHookHandler {
  const guard: GuardFn = async function laneGuardHook(req: FastifyRequest, reply: FastifyReply) {
    const jobType = req.routeOptions?.url ?? req.url
    if (scoped.has(req) && claimedLeaseOf(req)) {
      const { scope } = lifeOf(req, reply)
      if (scope && (await adoptHeldLease(req, scope, lane))) return
    }
    const decision = laneGuardDecision(opts, req)
    if (!decision) return
    if (!scoped.has(req)) {
      countUngated(jobType)
      return
    }
    const { scope } = lifeOf(req, reply)
    if (!scope) return
    try {
      await takeRequestSlot(scope, { lane, provider: decision.provider, jobType })
    } catch (err) {
      if (sendLaneAnswer(reply, err)) return reply
      throw err
    }
  }
  guard[LANE_OF_GUARD] = lane
  if (opts.rule) guard[RULE_OF_GUARD] = opts.rule
  return guard
}

/**
 * Take the request's slot of `lane` from inside a handler only if one is free
 * now — for optional work a request does without when its user is at their
 * limit (an approval's caption). True when the work may run: the slot was
 * granted, or the request runs under its caller's slot (or none at all);
 * false when the slot is busy — nothing waited, nothing is held. A request a
 * job makes in-process under its run or coordinator hold asks the same way,
 * for a front-of-line slot of the job's line, and is refused the same way
 * when none is free (never waiting under the queue timeout). Once granted the
 * request holds a leaf, so its own funnel calls take no second slot. With
 * enforcement off every slot is granted at once, so this is always true.
 */
export async function takeLiveLaneIfFree(req: FastifyRequest, opts: { lane: LeafLane; provider: string | null }): Promise<boolean> {
  const scope = lives.get(req)?.scope
  const jobType = req.routeOptions?.url ?? req.url
  if (!scope) {
    if (!scoped.has(req)) countUngated(jobType)
    return true
  }
  if (scope.hold.role !== "request") return true
  try {
    await takeRequestSlot(scope, { lane: opts.lane, provider: opts.provider, jobType, noWait: true })
    return true
  } catch (err) {
    if (err instanceof LaneBusyError || err instanceof LaneWaitTimeoutError) return false
    throw err
  }
}

/**
 * Take the request's slot of `lane` from inside a handler — a stream, right
 * after its headers are written, so `onWaiting` can tell the client where it
 * stands. Throws LaneBusyError past the live-wait limit, LaneWaitAbortedError
 * when the client leaves while it waits. `release` frees the slot early; the
 * wrapper frees it when the handler settles anyway. In a request that already
 * holds a slot (or runs under its caller's), nothing is taken and `release`
 * does nothing.
 */
export async function acquireLiveLane(
  req: FastifyRequest,
  opts: { lane: LeafLane; provider: string | null; onWaiting: (wait: WaitInfo) => void },
): Promise<{ release(outcome: ReleaseOutcome): Promise<void> }> {
  const none = { release: async () => undefined }
  const scope = lives.get(req)?.scope
  const jobType = req.routeOptions?.url ?? req.url
  if (!scope) {
    if (!scoped.has(req)) countUngated(jobType)
    return none
  }
  if (scope.hold.role !== "request") return none
  await takeRequestSlot(scope, { lane: opts.lane, provider: opts.provider, jobType, onWaiting: opts.onWaiting })
  const leaseId = scope.request?.lease?.leaseId
  if (!leaseId) return none
  return {
    release: async (outcome) => {
      if (scope.request?.lease?.leaseId === leaseId) await releaseRequestSlot(scope, outcome)
    },
  }
}
