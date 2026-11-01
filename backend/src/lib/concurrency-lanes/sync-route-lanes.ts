// backend/src/lib/concurrency-lanes/sync-route-lanes.ts — the lane rule of
// every route a workflow's sync-HTTP node calls whose work takes a slot in the
// request: the lane, the provider the work counts against, and whether a
// given request does that work at all. One rule, read on both sides of the
// hop:
//   - the route builds its laneGuard from it (`syncRouteLane`), so a live
//     request (the editor, the API, MCP) waits for the slot before it reserves;
//   - the orchestrator asks it of the body it is about to send
//     (`syncRouteLaneDecision`), takes that slot itself under the run's hold
//     and the queue timeout, and names it in LANE_LEASE_HEADER, which the
//     route's guard honours — one slot per node run, and a workflow never
//     waits under the live-wait limit.
// The orchestrator process registers no route, so this table — not the
// routes' registrations (`laneOfRoute`) — is what it reads; a guard test holds
// the two together (sync-node-lanes-totality.test.ts).
//
// Every question reads the raw body (and headers) before validation, exactly
// what the route's guard reads; the decision itself is laneGuardDecision's.
// Nothing here imports a route.
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { pickerAnalyzerProvider, wantsEventStream } from "../describe-to-picker-request.js"
import { judgeModelOf, requestedStrategy } from "../reduce-request.js"
import { wantsJobIdFirst } from "../request-helpers.js"
import type { LeafLane } from "./leaf-lanes.js"
import { llmProviderOf, llmProviderOfBody, rawBodyOf } from "./live-routes.js"
import { laneGuardDecision, type LaneGuardOpts, type LaneRequestView } from "./request-scope.js"

/** A sync route's lane rule: its lane, and laneGuard's questions over the raw request. */
export interface SyncRouteLaneRule extends Required<Pick<LaneGuardOpts<LaneRequestView>, "provider">> {
  readonly lane: LeafLane
  readonly when?: (req: LaneRequestView) => boolean
}

const llm = (provider: (req: LaneRequestView) => string | null, when?: (req: LaneRequestView) => boolean): SyncRouteLaneRule =>
  Object.freeze({ lane: "llm" as const, provider, ...(when ? { when } : {}) })

/** Route url (its registered path) → its lane rule. Only routes a sync-HTTP node calls. */
export const SYNC_ROUTE_LANE_RULES: Readonly<Record<string, SyncRouteLaneRule>> = Object.freeze({
  "/v1/llm-chat/generate": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["llm-chat"])),
  "/v1/ai-writer/generate": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["ai-writer"])),
  "/v1/scene-graph/generate": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["scene-graph-ai"])),
  "/v1/after-effects/generate": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["after-effects"])),
  "/v1/lottie-overlay/generate": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["lottie-overlay"])),
  "/v1/3d-title/generate": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["3d-title"])),
  "/v1/motion-graphics/generate": llm(
    llmProviderOfBody((body) => LLM_FEATURE_DEFAULTS[body.engine === "lottie" ? "motion-graphics-lottie" : "motion-graphics"]),
  ),
  "/v1/image-to-text/describe": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["image-to-text"])),
  "/v1/qa-check": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["qa-check"])),
  "/v1/image-critic": llm(llmProviderOfBody(LLM_FEATURE_DEFAULTS["image-critic"])),
  // A streamed answer (Accept: text/event-stream) takes its slot inside the
  // stream, where the client can be told it is waiting (streamAnalysis).
  "/v1/describe-to-picker": llm(pickerAnalyzerProvider, (req) => !wantsEventStream(req)),
  // Only the AI judge calls a model; every other strategy is local logic.
  "/v1/reduce": llm(
    (req) => llmProviderOf(judgeModelOf(req.body) ?? LLM_FEATURE_DEFAULTS["pick-best-llm"]),
    (req) => requestedStrategy(req.body) === "pick-best-llm",
  ),
  // A synchronous scrape runs its provider work in the request. A job-id-first
  // request answers at once and takes none, and an RSS feed is a plain fetch
  // here, not provider work.
  "/v1/web-scrape": Object.freeze({
    lane: "provider" as const,
    provider: () => "apify",
    when: (req: LaneRequestView) => !wantsJobIdFirst(req.body) && rawBodyOf(req).actor !== "rss",
  }),
  "/v1/meta-ads-scrape": Object.freeze({
    lane: "provider" as const,
    provider: () => "apify",
    when: (req: LaneRequestView) => !wantsJobIdFirst(req.body),
  }),
  // The style boost calls the provider in the request, as Suno's voice routes do.
  "/v1/suno/style-boost": Object.freeze({ lane: "provider" as const, provider: () => "kie" }),
})

function ruleOf(url: string): SyncRouteLaneRule {
  const rule = SYNC_ROUTE_LANE_RULES[url]
  if (!rule) throw new Error(`no sync route lane rule for ${url}`)
  return rule
}

/**
 * laneGuard's arguments for the route at `url`, from its rule — the route
 * writes `laneGuard(...syncRouteLane(url))`, LAST in its preHandlers, as any
 * laneGuard. The guard is marked with the rule (`laneRuleOfRoute`).
 */
export function syncRouteLane(url: string): readonly [LeafLane, LaneGuardOpts<LaneRequestView>] {
  const rule = ruleOf(url)
  return [rule.lane, { provider: rule.provider, ...(rule.when ? { when: rule.when } : {}), rule: url }]
}

/**
 * What the route at `url` takes for a request with this raw body and these
 * headers: its lane and provider, or null when the route takes no slot for it
 * (no rule, or its `when` says no). The orchestrator's question, answered by
 * the same decision laneGuard makes. Header names are matched lower-case, as
 * a received request's are.
 */
export function syncRouteLaneDecision(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): { lane: LeafLane; provider: string | null } | null {
  const rule = SYNC_ROUTE_LANE_RULES[url]
  if (!rule) return null
  const view: LaneRequestView = {
    // What the route will read: the body as it arrives, through JSON.
    body: body === undefined ? undefined : (JSON.parse(JSON.stringify(body)) as unknown),
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  }
  const decision = laneGuardDecision(rule, view)
  return decision ? { lane: rule.lane, provider: decision.provider } : null
}
