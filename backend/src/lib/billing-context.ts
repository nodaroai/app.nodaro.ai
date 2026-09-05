/**
 * Who pays for this work, under which entitlements (E2/P14).
 *
 * A core seam with no rule of its own — the same shape as
 * `workflow-access.ts`, and for the same reason. When the organizations
 * plugin is present AND switched on, its `services.billing.resolve` decides:
 * it owns the membership tables, the run predicate and the entitlement
 * grade. Without it there are no workspaces and no budgets, so the only
 * answer possible is the one this product has always given: the person
 * doing the work pays for it.
 *
 * THE RESOLVE-ONCE RULE. The answer is computed once per lane and carried:
 *   - per HTTP request — the preHandler below stamps `req.billingContext`;
 *   - per execution/enqueue — the enqueuing site stamps the resolved context
 *     on the queue payload, and workers read the payload, NEVER this seam.
 * Re-resolving downstream is how one run bills two different payers when a
 * membership changes mid-flight; nothing below a resolve point may call this.
 *
 * ABSENT means PERSONAL. `req.billingContext` unset, a payload without the
 * field, a plugin that predates the seam, the flag off — every one of them
 * reads as `{ payer: "user" }`. That is also the FAILURE answer: a resolver
 * error degrades to the personal payer (loudly), because the personal pocket
 * is the only one the caller always has the right to spend — failing toward
 * a workspace would spend someone else's money on an error path.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { hasOrganizations } from "./config.js"
import { supabase } from "./supabase.js"
import { getPluginServices } from "./private-plugins/load.js"
import type {
  PluginBillingContext,
  PluginBillingResolveInput,
  PluginBillingService,
  PluginOrgEntitlements,
} from "./private-plugins/types.js"
import { extractWorkflowId } from "./request-helpers.js"
import { deploymentPayerActive, deploymentBillingContext } from "./deployment-payer.js"

/**
 * The entitlement grade a DEPLOYMENT payer's work runs under (deployment-payer
 * item 9, decision D2). Watermark-off and cap-off are literal-typed like the
 * org grade (a deployment context that watermarks cannot be constructed);
 * `tierForGates`/`parallelism` are the PAYER account's grade, read at resolve
 * time — parallelism applies PER REQUESTER (each user gets their own
 * concurrency budget at the payer's tier), never as one shared instance pool.
 */
export interface DeploymentEntitlements {
  watermark: false
  dailyCapCredits: null
  parallelism: number
  tierForGates: string
}

/**
 * The third payer (deployment-payer item 9): one designated account pays for
 * everything on this instance. Constructed ONLY in core
 * (lib/deployment-payer.ts, from the surface profile) — it never crosses the
 * plugin boundary, so `isBillingContext` below deliberately does not admit it.
 * `userId` stays the REQUESTER (the workspace precedent: every existing
 * `ctx.userId` read means "the human doing the work"); the debit target lives
 * in `payerId`, and only deployment-aware spend sites read it.
 */
export interface DeploymentBillingContext {
  payer: "deployment"
  /** The human doing the work — jobs.user_id and ownership stay this. */
  userId: string
  /** The deployment payer account — the DEBIT user. */
  payerId: string
  entitlements: DeploymentEntitlements
}

export type BillingContext = PluginBillingContext | DeploymentBillingContext
export type OrgEntitlements = PluginOrgEntitlements
export type BillingResolveInput = PluginBillingResolveInput

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Runtime truth for the contract's compile-time claim. The context crosses a
 * process boundary — the plugin's version is a build argument tracked nowhere
 * in git — so a malformed return (an older/newer plugin, additive drift) must
 * degrade exactly like a throw: to the personal payer, loudly. Without this,
 * a context missing `entitlements` 500s the credit-guard hot path for every
 * workspace member the moment a spend site deep-destructures it.
 *
 * PLUGIN SHAPES ONLY, deliberately: `payer: "deployment"` is constructed in
 * core (lib/deployment-payer.ts) and never crosses the process boundary this
 * guard exists for — a plugin returning it is malformed and degrades like
 * any other malformed answer.
 */
export function isBillingContext(v: unknown): v is BillingContext {
  if (!v || typeof v !== "object") return false
  const c = v as Record<string, unknown>
  if (typeof c.userId !== "string") return false
  if (c.payer === "user") return true
  if (c.payer !== "workspace") return false
  const ent = c.entitlements as Record<string, unknown> | undefined
  return (
    typeof c.workspaceId === "string" &&
    typeof c.orgId === "string" &&
    (c.memberCap === null || typeof c.memberCap === "number") &&
    !!ent &&
    typeof ent === "object" &&
    ent.watermark === false &&
    ent.dailyCapCredits === null &&
    typeof ent.parallelism === "number" &&
    ent.tierForGates === "business" &&
    // The three gate literals the entitlement override (org-entitlements.ts)
    // reads at the spend sites. Compile-time literals in the contract, but
    // this value crossed a process boundary from a build-arg-pinned plugin —
    // runtime truth is this check, and each of these relaxes a personal gate
    // the moment it is consumed.
    ent.freeTierBlocklist === false &&
    ent.webFreeMode === false &&
    ent.appCreditsAllowance === false
  )
}

/**
 * Runtime validator for a DEPLOYMENT context that crossed a durable boundary
 * — today that is exactly one place: the pipeline payer stamp
 * (`pipelines.config.billingContext`, read back by pipeline-payer.ts on
 * req-less worker lanes). `isBillingContext` deliberately rejects this shape
 * (it guards the PLUGIN boundary), so a reader of stored contexts must ask
 * both — without this, every pipeline on a deployment-payer instance would
 * degrade its stored stamp to the requester's personal payer and quietly
 * bill the pocket the deployment promised to cover. Same literal-checking
 * posture as the workspace guard: a "deployment" context that watermarks or
 * daily-caps cannot ride in from a row.
 */
export function isDeploymentBillingContext(v: unknown): v is DeploymentBillingContext {
  if (!v || typeof v !== "object") return false
  const c = v as Record<string, unknown>
  if (c.payer !== "deployment") return false
  if (typeof c.userId !== "string" || typeof c.payerId !== "string") return false
  const ent = c.entitlements as Record<string, unknown> | undefined
  return (
    !!ent &&
    typeof ent === "object" &&
    ent.watermark === false &&
    ent.dailyCapCredits === null &&
    typeof ent.parallelism === "number" &&
    typeof ent.tierForGates === "string"
  )
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `registerBillingContextHook` for any authenticated request. */
    billingContext?: BillingContext
  }
}

/**
 * The capable service, or null. Both gates on purpose (the
 * `workflow-access.ts` discipline): `hasOrganizations()` because the plugin
 * builds its service object even when the feature flag is off, and the
 * member probe because `CLOUD_PLUGINS_VERSION` is a build argument tracked
 * nowhere in git — an older plugin simply has no workspace payers, and the
 * product must behave as if organizations do not exist rather than crash.
 */
export function billingService(): PluginBillingService | null {
  if (!hasOrganizations()) return null
  const billing = getPluginServices().billing
  return typeof billing?.resolve === "function" ? billing : null
}

/** The answer every lane starts from, and every failure returns to. */
export function personalPayer(userId: string): BillingContext {
  return { payer: "user", userId }
}

/**
 * The DEGRADED-context refusal (P14). A resolver failure degrades to the
 * personal payer, marked — and for work HOMED IN A WORKSPACE that fallback
 * would silently bill the member's own pocket for class work, the one
 * direction this whole seam exists to prevent. A run-creation surface asks
 * this before enqueueing: true ⇒ refuse the run (503-shaped where the caller
 * is authenticated; the fire lanes keep their uniform responses and skip),
 * retryable, the personal pocket untouched. Personal-homed work proceeds on
 * the degraded personal answer — it is the answer that work always had.
 */
export function shouldRefuseDegradedRun(
  ctx: BillingContext,
  workflowWorkspaceId: string | null | undefined,
): boolean {
  return ctx.payer === "user" && ctx.degraded === true && workflowWorkspaceId != null
}

/**
 * The same question for a surface that has NOT already loaded the workflow
 * row — the ONE probe every such lane shares, because five copies of a
 * security decision are five places to fail it differently.
 *
 * FAIL-CLOSED on the probe itself: the resolver degrades on exactly the
 * database blips that would also fail this read, so an unreadable home +
 * a degraded payer must refuse — treating "unknown" as "personal" would
 * bill the member in precisely the outage this guard exists for. Costs one
 * indexed select, on the rare degraded path only.
 */
export async function shouldRefuseDegradedRunFor(
  ctx: BillingContext,
  workflowId: string,
): Promise<boolean> {
  if (!(ctx.payer === "user" && ctx.degraded === true)) return false
  const { data, error } = await supabase
    .from("workflows")
    .select("workspace_id")
    .eq("id", workflowId)
    .maybeSingle()
  if (error) {
    console.error(
      `[billing-context] cannot read the home of workflow ${workflowId} on a degraded payer — refusing:`,
      error.message,
    )
    return true
  }
  return shouldRefuseDegradedRun(ctx, (data?.workspace_id as string | null | undefined) ?? null)
}

/**
 * The NORMATIVE absent-field rule (decision #7): a queue payload with no
 * `billingContext` reads as `{ payer: "user", userId: payload.userId }`,
 * unconditionally and permanently — old-API→new-worker and rollback windows
 * depend on it. The TYPE requires the field (a new producer is
 * compile-forced); the WIRE may still predate it, which is why the read
 * widens instead of trusting the annotation.
 */
export function payloadBillingContext(payload: { userId: string; billingContext?: BillingContext }): BillingContext {
  return payload.billingContext ?? personalPayer(payload.userId)
}

/**
 * Resolve once. Callers are the RESOLVE POINTS only: the preHandler below,
 * run-creation routes, and enqueue sites for req-less lanes — never workers,
 * never anything that already received a context.
 */
export async function resolveBillingContext(input: BillingResolveInput): Promise<BillingContext> {
  // Deployment payer (item 9) — the TOP rung, before the plugin gate: on
  // the instance this exists for there IS no orgs plugin, so any placement
  // after `if (!svc)` would be dead code exactly where it matters. When one
  // account pays for the whole instance there is nothing left to resolve —
  // the answer is the same for every request, workspace headers included.
  if (deploymentPayerActive()) return deploymentBillingContext(input.userId)
  const svc = billingService()
  if (!svc) return personalPayer(input.userId)
  // The internal-lane rung-1 strip is a CORE invariant, not a plugin promise:
  // every resolve point (the hook, run-creation routes, enqueue sites) passes
  // through here, so an internal caller that forgot to strip its workflowId
  // still cannot re-run rung 1 (decision #7 — one payer per execution).
  const safe = input.internal ? { ...input, workflowId: undefined } : input
  try {
    const ctx = await svc.resolve(safe)
    if (!isBillingContext(ctx)) {
      console.error(
        `[billing-context] resolver returned a malformed context for user ${input.userId} — personal payer`,
      )
      return { payer: "user", userId: input.userId, degraded: true }
    }
    return ctx
  } catch (err) {
    console.error(
      `[billing-context] resolve failed for user ${input.userId} — personal payer:`,
      (err as Error).message,
    )
    // `degraded` marks a FALLBACK personal answer (resolver failure), never a
    // resolved one — a spend site may refuse it where silently charging the
    // member for work they asked a workspace to pay would be worse.
    return { payer: "user", userId: input.userId, degraded: true }
  }
}

/**
 * The per-request resolve point. Registered in app.ts AFTER
 * `registerOrgsContextHook` — rung 2 reads the `req.workspaceId` that hook
 * validated, so the order is load-bearing.
 *
 * Cost on the hot path: zero queries for a personal request. The plugin is
 * only consulted when the request names a workspace (validated header) or a
 * workflow (`withWorkflowId()` injects one on most editor generation POSTs —
 * that rung is one indexed `workspace_id` read inside the resolver, which
 * short-circuits on NULL).
 *
 * The INTERNAL lane (`authKind === "internal"`: orchestrator loopback, MCP
 * dispatch) never re-runs rung 1 — the loopback body carries the run's
 * `workflowId`, and re-resolving from it here would out-rank the forwarded
 * answer and let a mid-run membership change split one execution across two
 * payers. On that lane the forwarded workspace header IS the decision, and
 * no header means the parent decided personal.
 */
export function registerBillingContextHook(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest) => {
    if (!req.userId) return

    // Reads never spend: resolving on every workspace-scoped GET would run
    // the standing check twice per request (the orgs hook already ran it)
    // for an answer nothing consumes. Spend sites live on mutating verbs.
    // Hoisted above the plugin gate so the deployment rung below shares it.
    if (req.method === "GET" || req.method === "HEAD") return

    // Deployment payer (item 9): stamped BEFORE the plugin gate — the
    // target instance has no orgs plugin, and `if (!svc) return` would
    // otherwise leave every request personal exactly where the payer is
    // configured. Sync + zero queries (cached grade, background-refreshed).
    if (deploymentPayerActive()) {
      req.billingContext = deploymentBillingContext(req.userId)
      return
    }

    const svc = billingService()
    if (!svc) return

    const internal = req.authKind === "internal"
    const rawWorkflowId = internal ? undefined : (extractWorkflowId(req.body) ?? undefined)
    // Client-supplied and outside every Zod schema: a non-uuid value would
    // only ever drive the resolver's error path (22P02) — drop it here, and
    // never 400 (the injected-field contract tolerates garbage).
    const workflowId = rawWorkflowId && UUID_RE.test(rawWorkflowId) ? rawWorkflowId : undefined

    // Trivially personal — nothing names a workspace or a workflow. Answer
    // without consulting the plugin at all.
    if (!workflowId && !req.workspaceId) {
      req.billingContext = personalPayer(req.userId)
      return
    }

    req.billingContext = await resolveBillingContext({
      userId: req.userId,
      explicitWorkspaceId: req.workspaceId,
      workflowId,
      isAppRun: req.isAppRun === true,
      internal,
    })
  })
}
