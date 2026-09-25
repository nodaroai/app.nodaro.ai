import type { FastifyInstance } from "fastify"

/**
 * Long-lived plugin processes, and the three toolkit members they motivated.
 *
 * Kept in its own file (the `scene3d-contract.ts` pattern) and re-exported
 * from `types.ts`, so the contract's hand-synced mirror in the plugin repo can
 * carry it as one file too. Every member here is ADDITIVE-OPTIONAL — no
 * CONTRACT_VERSION bump: an older host has none of them, so a plugin
 * `?.`-guards each one and an older plugin simply never asks.
 *
 * Content-free on purpose: nothing below knows what a daemon connects to.
 */

// ============================================================================
// Daemons — hosted by `backend/src/plugin-daemons.ts`
// ============================================================================

/**
 * What the host hands a daemon when it starts it.
 */
export interface PluginDaemonContext {
  /**
   * Aborted on SIGTERM/SIGINT. The daemon stops taking work, releases what it
   * holds (leases, connections) and lets `start()` resolve. The host waits a
   * bounded drain window for that, then closes regardless.
   */
  signal: AbortSignal
}

/** A cheap, synchronous snapshot for the host's `/health`. */
export interface PluginDaemonHealth {
  /**
   * `false` turns the host's `/health` into a 503, which the platform reads as
   * "this process is unusable" (a deploy whose health check fails is not
   * promoted). Report it for that only — one degraded account is `detail`,
   * never `ok: false`.
   */
  ok: boolean
  /**
   * Counters only — never an id, a name or anything a secret could hide in.
   * `/health` is the one route on the internal listener that answers without
   * the internal secret (the platform's health probe cannot send one), so the
   * host enforces it: only finite numbers and booleans under plain keys
   * (`[A-Za-z0-9_]`, at most 20) are passed through; everything else is dropped.
   */
  detail?: Record<string, number | boolean>
}

/**
 * One long-lived process a plugin contributes.
 *
 * `daemons(tk)` is called ONLY by the daemon host (the API server and the
 * workers never ask for daemons), and constructing the list must have no side
 * effects: work begins in `start()`.
 */
export interface PluginDaemon {
  /**
   * Unique across every plugin; also the URL prefix of this daemon's internal
   * routes (`/<name>/...`). Lowercase letters, digits and dashes; `health` is
   * reserved by the host. A duplicate, reserved or malformed name is a load
   * failure.
   */
  name: string
  /**
   * Routes on the host's INTERNAL listener, mounted under `/<name>`. Called
   * once, before the listener opens (Fastify cannot add routes after that).
   * Every route here sits behind the host's internal-secret check — a daemon
   * never sees, stores or compares the secret: the host removes the header
   * from the request once it has checked it.
   */
  registerInternalRoutes?(app: FastifyInstance): Promise<void>
  /**
   * Runs for the life of the process. Resolve only after `ctx.signal`
   * aborted and the daemon drained. A rejection — or resolving while the
   * signal is still live — is a crash: the host exits non-zero and the
   * platform restarts the process.
   */
  start(ctx: PluginDaemonContext): Promise<void>
  health?(): PluginDaemonHealth
}

// ============================================================================
// tk.daemons — the API side of the internal hop
// ============================================================================

export interface PluginDaemonRequest {
  /** The target daemon's `name`. */
  daemon: string
  /** Path inside that daemon's routes, starting with `/`. */
  path: string
  method?: "GET" | "POST" | "DELETE"
  /** Sent as JSON. */
  body?: unknown
  /** Default 10 s, capped at 120 s (a long-poll may hold the hop open). */
  timeoutMs?: number
}

export type PluginDaemonResponse =
  | { reachable: true; status: number; body: unknown }
  | { reachable: false; error: "unreachable" | "timeout" }

/**
 * Calls a route a daemon registered on the host's internal listener. The host
 * supplies the listener's address and the internal secret, so a plugin never
 * reads either from the environment. An unreachable daemon is an ANSWER, not
 * a throw: the calling route decides what the user sees (typically a 503).
 */
export interface PluginDaemonClientToolkit {
  request(input: PluginDaemonRequest): Promise<PluginDaemonResponse>
}

// ============================================================================
// tk.redis.lease — single-holder ownership across processes and replicas
// ============================================================================

/**
 * A Redis lease: `SET NX PX` to take it, compare-and-extend to keep it,
 * compare-and-delete to give it back, so a holder whose lease expired and was
 * taken over can neither extend nor release the new holder's. Keys are
 * namespaced by the host (a plugin key cannot collide with an app key).
 */
export interface PluginRedisLeaseToolkit {
  /** The owner token, or null while someone else holds the lease. */
  acquire(key: string, ttlMs: number): Promise<string | null>
  /** True while `token` still owns the lease (and it now lives `ttlMs` more). */
  renew(key: string, token: string, ttlMs: number): Promise<boolean>
  /** True when `token` owned the lease and it is now gone. */
  release(key: string, token: string): Promise<boolean>
}

// ============================================================================
// tk.accountSecrets — the generic, service-role-only account-secret store
// ============================================================================

/**
 * One stored account, as every process may see it: never the ciphertext,
 * never the secret. `metadata` is for what the owner is shown (a masked
 * handle, a display name) and must never carry a secret.
 */
export interface PluginAccountSecretRow {
  id: string
  plugin: string
  kind: string
  userId: string
  /** The account's own identity at its provider — one row per (plugin, kind, owner, externalId). */
  externalId: string
  label: string | null
  /** Plugin-defined (`active`, `paused`, `revoked`, …). */
  status: string
  statusReason: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface PluginAccountSecretUpsert {
  plugin: string
  kind: string
  userId: string
  externalId: string
  label?: string | null
  /** Encrypted as ONE envelope with the instance cipher; readable again only through `open`. */
  secret: Record<string, string>
  metadata?: Record<string, unknown>
  /**
   * Default `active`, and the status reason is cleared on every upsert — a
   * reconnect re-activates the account. A plugin with a sticky status (an
   * admin kill switch) must check it BEFORE letting the owner log in again.
   */
  status?: string
}

/**
 * Whose rows a metadata call may reach — stated on EVERY call, never implied.
 *
 * `userId` is the ownership check a route acting for a signed-in user must
 * make (someone else's row reads as absent). `allOwners: true` is the
 * deliberate, greppable opt-out for the daemon acting on the accounts it
 * holds, or an admin surface. Passing neither (or both) throws, so a route
 * that forgets the owner fails loudly instead of quietly reaching every
 * user's accounts — plugin routes live outside this app's tenant-scope lint.
 */
export type PluginAccountOwnerScope = { userId: string; allOwners?: never } | { allOwners: true; userId?: never }

export type PluginAccountSecretUpdate = PluginAccountOwnerScope & {
  plugin: string
  id: string
  status?: string
  statusReason?: string | null
  label?: string | null
  /** Replaces the stored metadata object (the caller merges). */
  metadata?: Record<string, unknown>
}

/**
 * Rows live in `plugin_account_secrets` (RLS on, no policies, no API-role
 * privileges — reachable only through this toolkit). Every call is scoped to
 * the plugin it names AND to this process's runtime environment
 * (`getRuntimeEnv()`, added by the host — a plugin cannot forget it): two
 * installs sharing one database each see only their own rows, so they never
 * open the same session twice. Metadata calls also state their owner scope
 * (`PluginAccountOwnerScope`). Per-owner account caps are the plugin's to
 * enforce.
 *
 * `upsert` and `open` exist ONLY in the toolkit the daemon host builds; every
 * other process gets the metadata surface alone. Every envelope is sealed with
 * a per-environment subkey and bound to its row (plugin, kind, environment,
 * owner, account), so a ciphertext copied onto another row — or read by
 * another environment's code holding the same instance key — does not open.
 * What this does NOT stop: first-party plugin code using `tk.db` (the
 * service-role client) to read or rewrite rows directly. It protects against
 * the API roles, mistakes and cross-environment access, not against the
 * plugin itself.
 */
export interface PluginAccountSecretsToolkit {
  /** Oldest first. Filters narrow; none widens past plugin + environment + owner scope. */
  list(
    query: PluginAccountOwnerScope & { plugin: string; kind?: string; statuses?: readonly string[] },
  ): Promise<PluginAccountSecretRow[]>
  /** Null when absent — including someone else's row under a `userId` scope. */
  get(query: PluginAccountOwnerScope & { plugin: string; id: string }): Promise<PluginAccountSecretRow | null>
  /** True when a row changed. */
  update(input: PluginAccountSecretUpdate): Promise<boolean>
  /** True when a row was deleted. */
  delete(query: PluginAccountOwnerScope & { plugin: string; id: string }): Promise<boolean>
  /** Daemon host only. Insert, or replace the secret of the same account. */
  upsert?(input: PluginAccountSecretUpsert): Promise<PluginAccountSecretRow>
  /** Daemon host only. Throws when the envelope cannot be opened (a changed key). */
  open?(query: {
    plugin: string
    id: string
  }): Promise<{ row: PluginAccountSecretRow; secret: Record<string, string> } | null>
}

/**
 * The trigger lanes a hosted daemon may serve. A lane is listed here only
 * when its rows are projected from the graph like the built-in lanes (the
 * CHECK on `workflow_triggers.type` and `workflow_executions.trigger_type`
 * admits it) and nothing else fires them.
 */
export type PluginTriggerLane = "telegram_account"

/** An active `workflow_triggers` row of a plugin lane. */
export interface PluginTriggerRow {
  id: string
  workflowId: string
  userId: string
  /** The node the row was projected from (`config.nodeId`), when it names one. */
  nodeId: string | null
  config: Record<string, unknown>
}

export interface PluginTriggerFireInput {
  /**
   * The row to fire. The host reads its workflow, owner and node from the
   * row itself — a daemon names a trigger, never a workflow or a user.
   */
  triggerId: string
  /**
   * The account the event arrived on. The host fires only when the row still
   * names this account and the account belongs to the row's owner — the
   * daemon's view may be up to one refresh stale.
   */
  accountId: string
  /** What the trigger node emits to the run (the message). JSON, ≤ 64 KB. */
  triggerData: Record<string, unknown>
  /**
   * Unique per owner within the lane: a second fire with the same key starts
   * nothing (`duplicate`) — at-least-once delivery becomes exactly-once runs.
   */
  idempotencyKey: string
}

export type PluginTriggerFireResult =
  | { fired: true; executionId: string }
  /**
   * `duplicate`: that key already started a run. `inactive`: the row is gone,
   * paused or not a plugin lane. `refused`: the owner may no longer run the
   * workflow (one visible failed row is recorded). `degraded`: the payer could
   * not be resolved safely, so nothing was billed or run. `throttled`: the
   * trigger is over its rate or already has the most runs in flight.
   */
  | { fired: false; reason: "duplicate" | "inactive" | "refused" | "degraded" | "throttled" }

/**
 * Trigger lanes for a hosted daemon — in the daemon host's toolkit only.
 * `fire` passes the fire-time gates
 * every built-in lane passes (access, payer at fire time, the degraded-billing
 * refusal, idempotency) before it inserts the execution and queues it; a
 * daemon cannot skip one.
 */
export interface PluginTriggersToolkit {
  /** Active rows of one lane, across all owners (the daemon serves them all). */
  listActive(query: { type: PluginTriggerLane }): Promise<PluginTriggerRow[]>
  fire(input: PluginTriggerFireInput): Promise<PluginTriggerFireResult>
}
